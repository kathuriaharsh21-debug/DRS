"""
Multi-frame cricket ball tracker.

Associates detections across frames using a greedy nearest-neighbour
algorithm with velocity prediction, manages track lifecycle (create /
update / prune), and provides trajectory smoothing via a moving-average
filter.
"""

import numpy as np
from typing import List, Optional, Dict, Tuple
from dataclasses import dataclass, field


@dataclass
class TrackPoint:
    """A single point on a ball trajectory.

    Attributes:
        x: Horizontal pixel position.
        y: Vertical pixel position.
        radius: Detected ball radius at this point.
        confidence: Detection confidence at this point.
        frame_number: Frame index in the video.
        timestamp: Video timestamp in seconds.
        vx: Estimated horizontal velocity (pixels / second).
        vy: Estimated vertical velocity (pixels / second).
    """
    x: float
    y: float
    radius: float
    confidence: float
    frame_number: int
    timestamp: float
    vx: float = 0.0
    vy: float = 0.0


@dataclass
class BallTrack:
    """An ordered sequence of :class:`TrackPoint` objects forming one
    complete ball trajectory.

    Attributes:
        track_id: Unique integer identifier for this track.
        points: Chronological list of track points.
        active: Whether the track is still receiving updates.
    """
    track_id: int
    points: List[TrackPoint] = field(default_factory=list)
    active: bool = True

    def add_point(self, point: TrackPoint) -> None:
        """Append *point* and compute its velocity from the previous point.

        Args:
            point: The new track point to append.
        """
        if self.points:
            last = self.points[-1]
            dt = point.timestamp - last.timestamp
            if dt > 0:
                point.vx = (point.x - last.x) / dt
                point.vy = (point.y - last.y) / dt
        self.points.append(point)

    def predict_next(self, assumed_fps: float = 30.0) -> Tuple[float, float]:
        """Predict the next ball position using a constant-velocity model.

        Args:
            assumed_fps: Framerate used when timestamp delta is zero.

        Returns:
            ``(predicted_x, predicted_y)`` in pixel coordinates.
        """
        if not self.points:
            return 0.0, 0.0
        if len(self.points) < 2:
            return self.points[-1].x, self.points[-1].y

        last = self.points[-1]
        dt = 1.0 / assumed_fps
        return (last.x + last.vx * dt, last.y + last.vy * dt)

    def get_smoothed_trajectory(self, window_size: int = 5) -> List[TrackPoint]:
        """Return a moving-average smoothed copy of the trajectory.

        Args:
            window_size: Number of points in the averaging window.

        Returns:
            A new list of :class:`TrackPoint` with averaged x/y values.
        """
        if len(self.points) < window_size:
            return list(self.points)

        smoothed: List[TrackPoint] = []
        for i in range(len(self.points)):
            start = max(0, i - window_size // 2)
            end = min(len(self.points), i + window_size // 2 + 1)
            avg_x = float(np.mean([p.x for p in self.points[start:end]]))
            avg_y = float(np.mean([p.y for p in self.points[start:end]]))
            p = self.points[i]
            smoothed.append(TrackPoint(
                x=avg_x, y=avg_y, radius=p.radius,
                confidence=p.confidence, frame_number=p.frame_number,
                timestamp=p.timestamp, vx=p.vx, vy=p.vy,
            ))
        return smoothed


class BallTracker:
    """Associates ball detections across video frames and maintains a
    set of :class:`BallTrack` objects.

    The association strategy is a **greedy nearest-neighbour** approach:
    existing tracks are extended by the closest (in Euclidean distance)
    detection that falls within ``max_distance`` pixels.  Unmatched
    detections spawn new tracks; tracks without updates for
    ``max_missing_frames`` consecutive frames are deactivated and
    eventually removed.
    """

    def __init__(
        self,
        max_distance: float = 100.0,
        max_missing_frames: int = 10,
    ):
        """Initialise the tracker.

        Args:
            max_distance: Maximum pixel distance for a detection-to-track
                association.
            max_missing_frames: Frames without update before a track is
                deactivated.
        """
        self.max_distance = max_distance
        self.max_missing_frames = max_missing_frames
        self.tracks: Dict[int, BallTrack] = {}
        self.next_track_id: int = 1

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def update(
        self,
        detections: list,
        frame_number: int,
        timestamp: float,
    ) -> Dict[int, BallTrack]:
        """Feed new detections for *frame_number* and return the current
        state of all tracks.

        Args:
            detections: List of :class:`BallDetection` objects (or any
                object with ``x``, ``y``, ``radius``, ``confidence``
                attributes).
            frame_number: Current frame index.
            timestamp: Current timestamp in seconds.

        Returns:
            Mapping of *track_id* → :class:`BallTrack`.
        """
        # Predict next position for each active track
        predicted: Dict[int, Tuple[float, float]] = {}
        for tid, track in self.tracks.items():
            if track.active:
                predicted[tid] = track.predict_next()

        # Associate detections to tracks
        if predicted and detections:
            associations = self._associate(detections, predicted)
            self._update_tracks(associations, detections, frame_number, timestamp)
        elif detections:
            for det in detections:
                self._create_track(det, frame_number, timestamp)

        self._prune_tracks(frame_number)
        return self.tracks

    def get_best_track(self) -> Optional[BallTrack]:
        """Return the longest active track with > 5 points, or fall back
        to the longest inactive track with > 3 points."""
        active = [t for t in self.tracks.values() if t.active and len(t.points) > 5]
        if active:
            return max(active, key=lambda t: len(t.points))

        all_tracks = [t for t in self.tracks.values() if len(t.points) > 3]
        if all_tracks:
            return max(all_tracks, key=lambda t: len(t.points))
        return None

    def get_longest_track(self) -> Optional[BallTrack]:
        """Return the track with the most points regardless of state."""
        if not self.tracks:
            return None
        return max(self.tracks.values(), key=lambda t: len(t.points))

    def reset(self) -> None:
        """Clear all tracks and reset the ID counter."""
        self.tracks.clear()
        self.next_track_id = 1

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _associate(
        self,
        detections: list,
        predicted: Dict[int, Tuple[float, float]],
    ) -> dict:
        """Greedy nearest-neighbour association via a cost matrix.

        Returns:
            ``{detection_index: track_id}``
        """
        cost_matrix: dict = {}
        for det_idx, det in enumerate(detections):
            for tid, (px, py) in predicted.items():
                dist = float(np.sqrt((det.x - px) ** 2 + (det.y - py) ** 2))
                if dist < self.max_distance:
                    cost_matrix[(det_idx, tid)] = dist

        associations: dict = {}
        for (det_idx, tid), _ in sorted(cost_matrix.items(), key=lambda x: x[1]):
            if det_idx not in associations and tid not in associations.values():
                associations[det_idx] = tid

        return associations

    def _update_tracks(
        self,
        associations: dict,
        detections: list,
        frame_number: int,
        timestamp: float,
    ) -> None:
        """Extend matched tracks; spawn new tracks for unmatched detections."""
        matched_dets = set(associations.keys())

        for det_idx, tid in associations.items():
            det = detections[det_idx]
            point = TrackPoint(
                x=float(det.x), y=float(det.y),
                radius=float(det.radius),
                confidence=float(det.confidence),
                frame_number=frame_number,
                timestamp=timestamp,
            )
            self.tracks[tid].add_point(point)

        for det_idx, det in enumerate(detections):
            if det_idx not in matched_dets:
                self._create_track(det, frame_number, timestamp)

    def _create_track(self, detection, frame_number: int, timestamp: float) -> None:
        """Create a new :class:`BallTrack` from a single detection."""
        point = TrackPoint(
            x=float(detection.x), y=float(detection.y),
            radius=float(detection.radius),
            confidence=float(detection.confidence),
            frame_number=frame_number,
            timestamp=timestamp,
        )
        track = BallTrack(track_id=self.next_track_id, points=[point])
        self.tracks[self.next_track_id] = track
        self.next_track_id += 1

    def _prune_tracks(self, current_frame: int) -> None:
        """Deactivate stale tracks and remove very old ones."""
        to_remove: List[int] = []
        for tid, track in self.tracks.items():
            if track.active:
                frames_since = current_frame - track.points[-1].frame_number
                if frames_since > self.max_missing_frames:
                    track.active = False
                if frames_since > self.max_missing_frames * 2:
                    to_remove.append(tid)
        for tid in to_remove:
            del self.tracks[tid]
