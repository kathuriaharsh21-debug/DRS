"""
Video processing orchestrator.

Coordinates the full computer-vision pipeline:

    1. Open video with OpenCV
    2. Extract frames at target FPS (with frame_skip)
    3. Detect ball in each frame (HSV + morphological)
    4. Track ball across frames (greedy nearest-neighbour)
    5. Estimate trajectory (Kalman filter)
    6. Map to pitch coordinates (perspective transform)
    7. Run decision engine (LBW / Wide / Bowled / No-ball)
    8. Generate annotated frames for visualisation
    9. Write annotated output video
    10. Return comprehensive JSON results
"""

import time
import logging
import uuid
from pathlib import Path
from typing import Optional, Dict, List, Any, Callable

import cv2
import numpy as np

from app.config import Settings
from app.core.ball_detector import BallDetector, BallDetection
from app.core.ball_tracker import BallTracker, BallTrack, TrackPoint
from app.core.trajectory_estimator import TrajectoryEstimator, TrajectoryPrediction
from app.core.pitch_mapper import PitchMapper, PitchCalibration
from app.core.decision_engine import DecisionEngine, DecisionResult
from app.utils.frame_utils import extract_frames, encode_frame_jpeg, get_video_info
from app.utils.drawing import (
    draw_trajectory_path,
    draw_ball_glow,
    draw_pitch_markings,
    draw_stumps,
    draw_label,
    draw_decision_overlay,
    draw_prediction_zone,
    draw_frame_info,
    draw_detection_box,
)

logger = logging.getLogger(__name__)


class ProcessingCallbacks:
    """Optional callbacks for progress reporting."""

    def __init__(
        self,
        on_progress: Optional[Callable[[float, str], None]] = None,
        on_frame: Optional[Callable[[int, dict], None]] = None,
        on_complete: Optional[Callable[[dict], None]] = None,
        on_error: Optional[Callable[[str], None]] = None,
    ):
        self.on_progress = on_progress
        self.on_frame = on_frame
        self.on_complete = on_complete
        self.on_error = on_error


class VideoProcessor:
    """Orchestrates the entire cricket-ball analysis pipeline.

    Usage::

        processor = VideoProcessor(settings)
        result = processor.process(video_path, job_id)
    """

    def __init__(self, settings: Settings):
        """Initialise with application settings.

        Args:
            settings: Application :class:`Settings` instance.
        """
        self.settings = settings
        self.upload_dir = Path(settings.upload_dir)
        self.output_dir = Path(settings.output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Main entry point
    # ------------------------------------------------------------------

    def process(
        self,
        video_path: str,
        job_id: str,
        ball_type: str = "red",
        frame_skip: int = 2,
        auto_calibrate: bool = True,
        calibration: Optional[Dict[str, List[int]]] = None,
        callbacks: Optional[ProcessingCallbacks] = None,
    ) -> Dict[str, Any]:
        """Process a video and return the full analysis result.

        Args:
            video_path: Absolute path to the uploaded video file.
            job_id: Unique job identifier.
            ball_type: ``"red"``, ``"white"``, or ``"pink"``.
            frame_skip: Process every Nth frame.
            auto_calibrate: Attempt automatic pitch-line detection.
            calibration: Manual calibration dict with keys
                ``top_left``, ``top_right``, ``bottom_left``,
                ``bottom_right``.
            callbacks: Optional :class:`ProcessingCallbacks` for
                progress reporting.

        Returns:
            Dictionary containing all analysis results.
        """
        start_time = time.time()
        callbacks = callbacks or ProcessingCallbacks()

        try:
            # Gather video metadata
            video_info = get_video_info(video_path)
            total_frames = video_info["frame_count"]
            fps = video_info["fps"]

            callbacks.on_progress and callbacks.on_progress(
                0.0, "Initialising pipeline components"
            )

            # --- Initialise pipeline components ---
            detector = BallDetector(
                ball_type=ball_type,
                min_radius=self.settings.ball_min_radius,
                max_radius=self.settings.ball_max_radius,
            )
            tracker = BallTracker(
                max_distance=self.settings.tracker_max_distance,
                max_missing_frames=self.settings.tracker_max_missing_frames,
            )
            estimator = TrajectoryEstimator(dt=1.0 / fps)
            mapper = PitchMapper()
            engine = DecisionEngine()

            # --- Pitch calibration ---
            cap = cv2.VideoCapture(video_path)
            ret, first_frame = cap.read()
            cap.release()

            if not ret:
                raise RuntimeError("Cannot read the first frame of the video")

            if calibration:
                cal = PitchCalibration(
                    top_left=tuple(calibration["top_left"]),
                    top_right=tuple(calibration["top_right"]),
                    bottom_left=tuple(calibration["bottom_left"]),
                    bottom_right=tuple(calibration["bottom_right"]),
                )
                mapper.set_calibration(cal)
            elif auto_calibrate:
                auto_cal = mapper.auto_detect_pitch(first_frame)
                if auto_cal:
                    mapper.set_calibration(auto_cal)

            # --- Frame-by-frame processing ---
            per_frame_data: List[Dict[str, Any]] = []
            all_trajectory_points: List[tuple] = []  # (x, y, frame, ts)
            frames_with_ball = 0
            processed_count = 0

            frame_gen = extract_frames(
                video_path,
                target_fps=self.settings.fps_target,
                frame_skip=frame_skip,
            )

            for frame, frame_number, timestamp in frame_gen:
                # Detect ball
                detections: List[BallDetection] = detector.detect(
                    frame, frame_number, timestamp
                )

                # Update tracker
                tracker.update(detections, frame_number, timestamp)

                # Record per-frame data
                best_track = tracker.get_best_track()
                ball_pos = None

                if detections:
                    frames_with_ball += 1
                    det = detections[0]
                    ball_pos = {
                        "x": det.x, "y": det.y,
                        "radius": det.radius,
                        "confidence": det.confidence,
                        "frame_number": det.frame_number,
                        "timestamp": det.timestamp,
                    }
                    all_trajectory_points.append(
                        (det.x, det.y, frame_number, timestamp)
                    )
                    estimator.add_point(det.x, det.y, frame_number, timestamp)

                # Store frame-level info
                frame_data = {
                    "frame_number": frame_number,
                    "timestamp": timestamp,
                    "ball_detected": bool(detections),
                    "ball_position": ball_pos,
                }
                per_frame_data.append(frame_data)

                processed_count += 1

                # Progress
                progress = min(processed_count / max(total_frames, 1), 1.0)
                callbacks.on_progress and callbacks.on_progress(
                    progress,
                    f"Processed frame {frame_number}/{total_frames} "
                    f"({frames_with_ball} with ball)"
                )
                callbacks.on_frame and callbacks.on_frame(frame_number, frame_data)

            # --- Trajectory estimation ---
            callbacks.on_progress and callbacks.on_progress(
                0.85, "Running trajectory estimation"
            )
            trajectory_result: TrajectoryPrediction = estimator.estimate(
                frame_shape=first_frame.shape
            )

            # --- Build trajectory data for decision engine ---
            trajectory_data = self._build_trajectory_data(
                trajectory_result, per_frame_data
            )

            # --- Decision engine ---
            callbacks.on_progress and callbacks.on_progress(
                0.92, "Running decision engine"
            )
            decision: DecisionResult = engine.analyze(
                trajectory_data,
                frame_shape=first_frame.shape[:2],
            )

            # --- Generate annotated video ---
            callbacks.on_progress and callbacks.on_progress(
                0.95, "Generating annotated video"
            )
            annotated_path = self._generate_annotated_video(
                video_path=video_path,
                job_id=job_id,
                per_frame_data=per_frame_data,
                best_track=tracker.get_best_track(),
                decision=decision,
                fps=fps,
                frame_skip=frame_skip,
                mapper=mapper,
            )

            # --- Compile results ---
            processing_time = time.time() - start_time

            result = {
                "job_id": job_id,
                "video_info": video_info,
                "ball_type": ball_type,
                "decision": decision.to_dict(),
                "trajectory": [
                    {"x": p.x, "y": p.y, "z": p.z,
                     "frame_number": p.frame_number, "timestamp": p.timestamp}
                    for p in trajectory_result.points
                ],
                "pitch_point": (
                    {"x": trajectory_result.pitch_point.x,
                     "y": trajectory_result.pitch_point.y}
                    if trajectory_result.pitch_point else None
                ),
                "impact_point": (
                    {"x": trajectory_result.impact_point.x,
                     "y": trajectory_result.impact_point.y}
                    if trajectory_result.impact_point else None
                ),
                "total_frames": total_frames,
                "frames_processed": processed_count,
                "frames_with_ball": frames_with_ball,
                "ball_speed_kmh": round(trajectory_result.ball_speed_mps * 3.6, 1),
                "deviation_degrees": trajectory_result.deviation_degrees,
                "predicted_stump_hit": trajectory_result.predicted_stump_hit,
                "confidence": trajectory_result.confidence,
                "processing_time": round(processing_time, 2),
                "annotated_video_path": str(annotated_path) if annotated_path else None,
                "per_frame_data": per_frame_data,
            }

            callbacks.on_complete and callbacks.on_complete(result)
            callbacks.on_progress and callbacks.on_progress(1.0, "Analysis complete")

            return result

        except Exception as exc:
            logger.exception("Processing failed for job %s", job_id)
            callbacks.on_error and callbacks.on_error(str(exc))
            raise

    # ------------------------------------------------------------------
    # Annotated video generation
    # ------------------------------------------------------------------

    def _generate_annotated_video(
        self,
        video_path: str,
        job_id: str,
        per_frame_data: List[Dict[str, Any]],
        best_track: Optional[BallTrack],
        decision: DecisionResult,
        fps: float,
        frame_skip: int,
        mapper: PitchMapper,
    ) -> Optional[str]:
        """Create an annotated output video with trajectory overlay.

        Returns:
            Path to the output video file, or ``None`` on failure.
        """
        output_path = self.output_dir / f"{job_id}_annotated.mp4"

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.warning("Cannot re-open video for annotation")
            return None

        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(output_path), fourcc, fps, (w, h))

        if not writer.isOpened():
            logger.warning("Cannot create VideoWriter")
            cap.release()
            return None

        # Build lookup from frame_number → detection
        det_lookup: Dict[int, dict] = {}
        for fd in per_frame_data:
            if fd["ball_detected"]:
                det_lookup[fd["frame_number"]] = fd["ball_position"]

        # Collect full trajectory points (pixel coords)
        trajectory_xy: List[tuple] = []
        if best_track:
            smoothed = best_track.get_smoothed_trajectory(window_size=5)
            trajectory_xy = [(p.x, p.y) for p in smoothed]

        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % frame_skip != 0:
                # Still write the frame (no skip in output video)
                writer.write(frame)
                frame_idx += 1
                continue

            # Draw pitch markings
            draw_pitch_markings(frame)

            # Draw trajectory up to current frame
            visible_pts = [
                (x, y) for x, y, fn, ts in
                [(tp[0], tp[1], 0, 0) for tp in trajectory_xy]
                if True  # show full trajectory on all frames
            ]
            if trajectory_xy:
                draw_trajectory_path(frame, trajectory_xy)

            # Draw ball position
            det = det_lookup.get(frame_idx)
            if det:
                draw_ball_glow(frame, det["x"], det["y"])
                draw_detection_box(
                    frame, det["x"], det["y"],
                    int(det["radius"]), det["confidence"]
                )

            # Draw stumps at batting end (estimated position)
            if mapper.calibration:
                _, bat_end_y = mapper.calibration.bottom_left
                cx = (mapper.calibration.bottom_left[0] +
                      mapper.calibration.bottom_right[0]) // 2
                draw_stumps(frame, cx, bat_end_y - 30)

            # Draw decision banner on last 30 frames
            total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if frame_idx > total - 30:
                draw_decision_overlay(
                    frame,
                    decision.decision.value,
                    decision.dismissal_type.value,
                    decision.confidence,
                    decision.ball_speed_kmh,
                )

            # Draw frame info
            draw_frame_info(frame, frame_idx, frame_idx / fps, fps)

            writer.write(frame)
            frame_idx += 1

        writer.release()
        cap.release()
        return str(output_path)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _build_trajectory_data(
        trajectory_result: TrajectoryPrediction,
        per_frame_data: List[Dict[str, Any]],
    ) -> dict:
        """Convert trajectory data into the format expected by
        :class:`DecisionEngine`."""
        data: dict = {
            "ball_speed_mps": trajectory_result.ball_speed_mps,
            "predicted_stump_hit": trajectory_result.predicted_stump_hit,
            "deviation_degrees": trajectory_result.deviation_degrees,
            "confidence": trajectory_result.confidence,
        }

        if trajectory_result.pitch_point:
            data["pitch_x"] = trajectory_result.pitch_point.x
            data["pitch_y"] = trajectory_result.pitch_point.y

        if trajectory_result.impact_point:
            data["impact_x"] = trajectory_result.impact_point.x
            data["impact_y"] = trajectory_result.impact_point.y

        # Heuristic: determine if ball hit pad vs went through to stumps
        # If the ball was detected at the end (near stumps) without
        # an intermediate gap, we assume it hit stumps directly.
        last_pts = per_frame_data[-10:] if per_frame_data else []
        data["hit_pad"] = False
        data["no_ball"] = False

        # Simple heuristic: if deviation is large (>5°), ball likely
        # hit pad and changed direction
        if abs(trajectory_result.deviation_degrees) > 5.0:
            data["hit_pad"] = True
            data["predicted_stump_hit"] = trajectory_result.predicted_stump_hit

        return data
