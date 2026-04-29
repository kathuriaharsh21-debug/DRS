"""
Video processing orchestrator — v3.

Key improvements over v2:
    - **Ball release detection**: Identifies the frame where the ball leaves
      the bowler's hand using velocity/jerk analysis. Run-up frames are
      excluded from trajectory estimation.
    - **Impact detection**: Identifies when the ball hits the batsman's pad
      by detecting sudden velocity changes near the batting crease.
    - **Proper prediction path**: Generates normalised pitch-coordinate
      predictions from the impact point to the stumps for LBW analysis.
    - **Cleaner trajectory output**: Only returns post-release trajectory
      points to the frontend.
"""

import time
import logging
import uuid
from pathlib import Path
from typing import Optional, Dict, List, Any, Callable, Tuple

import cv2
import numpy as np

from app.config import Settings
from app.core.ball_detector import (
    BallDetector, BallDetection, YOLOBallDetector,
)
from app.core.ball_tracker import BallTracker, BallTrack, TrackPoint
from app.core.trajectory_estimator import (
    TrajectoryEstimator, TrajectoryPrediction,
)
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
    """Orchestrates the entire cricket-ball analysis pipeline (v3).

    Automatically selects the best available detection/tracking/trajectory
    tier based on installed packages and available hardware.
    """

    def __init__(self, settings: Settings):
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
        """Process a video and return the full analysis result."""
        start_time = time.time()
        callbacks = callbacks or ProcessingCallbacks()

        try:
            video_info = get_video_info(video_path)
            total_frames = video_info["frame_count"]
            fps = video_info["fps"]
            frame_h = video_info.get("height", 720)

            callbacks.on_progress and callbacks.on_progress(
                0.0, "Initialising v3 pipeline with release detection"
            )

            detection_tier = self.settings.detection_tier
            tracking_tier = self.settings.tracking_tier
            use_ukf = self.settings.use_ukf

            detector = BallDetector(
                ball_type=ball_type or self.settings.ball_type,
                min_radius=self.settings.ball_min_radius,
                max_radius=self.settings.ball_max_radius,
                min_confidence=self.settings.detection_confidence,
                detection_tier=detection_tier,
                model_path=self.settings.yolo_model_path,
                yolo_conf=self.settings.yolo_confidence,
                yolo_imgsz=self.settings.yolo_imgsz,
                device=self.settings.yolo_device,
            )

            tracker = BallTracker(
                tracking_tier=tracking_tier,
                max_distance=self.settings.tracker_max_distance,
                max_missing_frames=self.settings.tracker_max_missing_frames,
            )

            estimator = TrajectoryEstimator(
                dt=1.0 / max(fps, 1.0),
                use_ukf=use_ukf,
            )

            mapper = PitchMapper()
            engine = DecisionEngine()

            logger.info(
                "Pipeline tiers: detection=%s, tracking=%s, trajectory=%s",
                detector.active_tier, tracker.active_tier, estimator.filter_type,
            )

            # --- Read first frame for calibration ---
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
                    logger.info("Auto-calibration successful")
                else:
                    logger.warning("Auto-calibration failed — using default frame mapping")

            # === Phase 1: Collect all raw detections ===
            raw_detections: List[Dict[str, Any]] = []
            per_frame_data: List[Dict[str, Any]] = []
            processed_count = 0

            frame_gen = extract_frames(
                video_path,
                target_fps=self.settings.fps_target,
                frame_skip=frame_skip,
            )

            for frame, frame_number, timestamp in frame_gen:
                detections: List[BallDetection] = detector.detect(
                    frame, frame_number, timestamp
                )

                tracker.update(detections, frame_number, timestamp, frame)

                ball_pos = None
                if detections:
                    det = detections[0]
                    ball_pos = {
                        "x": det.x, "y": det.y,
                        "radius": det.radius,
                        "confidence": det.confidence,
                        "frame_number": det.frame_number,
                        "timestamp": det.timestamp,
                    }
                    raw_detections.append({
                        "x": det.x, "y": det.y,
                        "radius": det.radius,
                        "confidence": det.confidence,
                        "frame_number": det.frame_number,
                        "timestamp": det.timestamp,
                    })

                frame_data = {
                    "frame_number": frame_number,
                    "timestamp": timestamp,
                    "ball_detected": bool(detections),
                    "ball_position": ball_pos,
                    "detection_tier": detector.active_tier,
                    "tracking_tier": tracker.active_tier,
                }
                per_frame_data.append(frame_data)
                processed_count += 1

                progress = min(processed_count / max(total_frames, 1), 1.0)
                callbacks.on_progress and callbacks.on_progress(
                    progress * 0.7,
                    f"[{detector.active_tier}] Frame {frame_number}/{total_frames}"
                )

            # === Phase 2: Detect ball release and impact frames ===
            callbacks.on_progress and callbacks.on_progress(
                0.72, "Detecting ball release point..."
            )

            release_idx = self._detect_release_frame(raw_detections, frame_h)
            impact_idx = self._detect_impact_frame(raw_detections, release_idx, frame_h)

            logger.info(
                "Release frame index: %d, Impact frame index: %d (of %d detections)",
                release_idx, impact_idx, len(raw_detections),
            )

            # === Phase 3: Build trajectory from release to impact only ===
            callbacks.on_progress and callbacks.on_progress(
                0.78, "Building post-release trajectory..."
            )

            # Determine the slice of detections to use
            if release_idx is not None and impact_idx is not None:
                active_dets = raw_detections[release_idx:impact_idx + 1]
            elif release_idx is not None:
                active_dets = raw_detections[release_idx:]
            else:
                active_dets = raw_detections

            # Reset estimator and feed only post-release points
            estimator.reset()
            for d in active_dets:
                estimator.add_point(d["x"], d["y"], d["frame_number"], d["timestamp"])

            # Also feed into a fresh tracker for clean post-release tracking
            tracker.reset()
            for d in active_dets:
                tracker.update(
                    [BallDetection(
                        x=d["x"], y=d["y"], radius=d["radius"],
                        confidence=d["confidence"],
                        frame_number=d["frame_number"], timestamp=d["timestamp"],
                    )],
                    d["frame_number"], d["timestamp"],
                )

            # === Phase 4: Trajectory estimation ===
            callbacks.on_progress and callbacks.on_progress(
                0.85,
                f"Running trajectory estimation ({estimator.filter_type})"
            )
            trajectory_result: TrajectoryPrediction = estimator.estimate(
                frame_shape=first_frame.shape
            )

            # === Phase 5: Build normalised prediction path ===
            callbacks.on_progress and callbacks.on_progress(
                0.88, "Generating LBW prediction path..."
            )

            normalised_prediction = self._build_normalised_prediction(
                trajectory_result, first_frame.shape
            )

            # === Phase 6: Build trajectory data for decision engine ===
            trajectory_data = self._build_trajectory_data(
                trajectory_result, per_frame_data, impact_idx
            )

            # === Phase 7: Decision engine ===
            callbacks.on_progress and callbacks.on_progress(
                0.92, "Running decision engine"
            )
            decision: DecisionResult = engine.analyze(
                trajectory_data,
                frame_shape=first_frame.shape[:2],
            )

            # === Phase 8: Annotated video ===
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
                trajectory_result=trajectory_result,
                release_idx=release_idx,
            )

            # === Compile results ===
            processing_time = time.time() - start_time

            # Return only post-release trajectory for clean frontend display
            post_release_trajectory = [
                {"x": p.x, "y": p.y, "z": p.z,
                 "frame_number": p.frame_number, "timestamp": p.timestamp}
                for p in trajectory_result.points
            ]

            result = {
                "job_id": job_id,
                "video_info": video_info,
                "ball_type": ball_type,
                "pipeline": {
                    "detection_tier": detector.active_tier,
                    "tracking_tier": tracker.active_tier,
                    "trajectory_filter": estimator.filter_type,
                },
                "decision": decision.to_dict(),
                "trajectory": post_release_trajectory,
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
                "release_frame": (
                    raw_detections[release_idx]["frame_number"]
                    if release_idx is not None else None
                ),
                "impact_frame": (
                    raw_detections[impact_idx]["frame_number"]
                    if impact_idx is not None else None
                ),
                "bounce_points": trajectory_result.bounce_points,
                "predicted_path": trajectory_result.predicted_path,
                # New: normalised prediction path for frontend pitch visualisation
                "normalised_prediction": normalised_prediction,
                "total_frames": total_frames,
                "frames_processed": processed_count,
                "frames_with_ball": len(raw_detections),
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
    # Ball release detection
    # ------------------------------------------------------------------

    @staticmethod
    def _detect_release_frame(
        detections: List[Dict[str, Any]],
        frame_height: int,
        min_detections: int = 10,
    ) -> Optional[int]:
        """Detect the frame where the ball is released from the bowler's hand.

        Strategy:
        1. Compute velocity between consecutive detections
        2. Compute jerk (rate of change of velocity)
        3. The release frame is where there's a sustained high velocity
           starting from the upper portion of the frame (bowler's hand area)
        4. During run-up the ball moves relatively slowly (carried by bowler)
        5. At release the ball accelerates rapidly

        Returns index into the detections list, or None if indeterminate.
        """
        if len(detections) < min_detections:
            return None

        velocities = []
        for i in range(1, len(detections)):
            dx = detections[i]["x"] - detections[i - 1]["x"]
            dy = detections[i]["y"] - detections[i - 1]["y"]
            dt = max(detections[i]["timestamp"] - detections[i - 1]["timestamp"], 1e-6)
            speed = float(np.sqrt(dx * dx + dy * dy)) / dt
            velocities.append(speed)

        if len(velocities) < 5:
            return None

        # Smooth velocities
        window = min(5, len(velocities) // 3)
        if window < 3:
            window = 3
        smoothed_vel = np.convolve(velocities, np.ones(window) / window, mode="same")

        # Compute jerk (derivative of velocity)
        jerks = []
        for i in range(1, len(smoothed_vel)):
            jerks.append(abs(smoothed_vel[i] - smoothed_vel[i - 1]))

        # Median velocity (typical run-up speed)
        median_vel = float(np.median(smoothed_vel))
        median_jerk = float(np.median(jerks)) if jerks else 0

        # The release happens at the first sustained high-velocity + high-jerk region
        # where the ball is in the upper portion of the frame
        vel_threshold = median_vel * 2.5 + 50  # at least 2.5x median + absolute
        jerk_threshold = median_jerk * 2.0 + 10

        # Look for the first cluster of 3+ consecutive frames with high velocity
        consecutive_high = 0
        required_consecutive = 3

        for i in range(len(smoothed_vel)):
            det_idx = i + 1  # velocity[i] is between detection i and i+1
            det = detections[det_idx]

            is_fast = smoothed_vel[i] > vel_threshold
            is_jerky = (i < len(jerks) and jerks[i] > jerk_threshold)
            is_upper = det["y"] < frame_height * 0.5  # upper half of frame

            if is_fast and (is_jerky or is_upper):
                consecutive_high += 1
                if consecutive_high >= required_consecutive:
                    # Release happened `required_consecutive` frames before this
                    release_det_idx = det_idx - required_consecutive + 1
                    return max(0, release_det_idx)
            else:
                consecutive_high = 0

        # Fallback: find the frame with maximum jerk
        if jerks:
            max_jerk_idx = int(np.argmax(jerks))
            return max(0, max_jerk_idx)

        return None

    # ------------------------------------------------------------------
    # Impact detection
    # ------------------------------------------------------------------

    @staticmethod
    def _detect_impact_frame(
        detections: List[Dict[str, Any]],
        release_idx: Optional[int],
        frame_height: int,
    ) -> Optional[int]:
        """Detect the frame where the ball impacts the batsman's pad.

        Strategy:
        1. Only look at detections after the release frame
        2. The ball should be in the lower portion of frame (near batsman)
        3. Impact is characterised by a sudden deceleration or disappearance
        4. Look for the last frame where the ball is still moving fast
           before it either disappears or slows dramatically

        Returns index into the detections list, or None.
        """
        if len(detections) < 5:
            return None

        start_idx = release_idx if release_idx is not None else 0
        if start_idx >= len(detections):
            return None

        post_release = detections[start_idx:]
        if len(post_release) < 3:
            return len(detections) - 1

        # Compute velocities in post-release
        velocities = []
        for i in range(1, len(post_release)):
            dx = post_release[i]["x"] - post_release[i - 1]["x"]
            dy = post_release[i]["y"] - post_release[i - 1]["y"]
            dt = max(post_release[i]["timestamp"] - post_release[i - 1]["timestamp"], 1e-6)
            speed = float(np.sqrt(dx * dx + dy * dy)) / dt
            velocities.append(speed)

        if not velocities:
            return len(detections) - 1

        # The ball is in the batsman zone (lower 40% of frame)
        batsman_zone_y = frame_height * 0.6

        # Find the last frame where ball is still moving reasonably fast
        # and is in the batsman zone
        median_vel = float(np.median(velocities))
        slowdown_threshold = median_vel * 0.3  # significant slowdown

        # Walk backwards from end to find last fast frame
        last_fast_idx = len(velocities) - 1
        for i in range(len(velocities) - 1, -1, -1):
            det = post_release[i + 1]
            in_batsman_zone = det["y"] >= batsman_zone_y

            if velocities[i] > slowdown_threshold:
                last_fast_idx = i
                break

        # Also check if there are trailing detections with very low velocity
        # (ball sitting on pad / ground) — include those as impact
        trailing_slow = 0
        for i in range(last_fast_idx + 1, len(velocities)):
            if velocities[i] < slowdown_threshold:
                trailing_slow += 1
            else:
                break

        impact_local_idx = last_fast_idx + min(trailing_slow, 2)
        impact_local_idx = min(impact_local_idx, len(post_release) - 1)

        return start_idx + impact_local_idx

    # ------------------------------------------------------------------
    # Normalised prediction path for frontend
    # ------------------------------------------------------------------

    @staticmethod
    def _build_normalised_prediction(
        trajectory_result: TrajectoryPrediction,
        frame_shape: Tuple[int, ...],
    ) -> List[Dict[str, float]]:
        """Build a normalised (0-1) prediction path from impact to stumps.

        Uses the UKF predicted path and the last trajectory points to
        extrapolate in normalised pitch coordinates, suitable for frontend
        pitch-map rendering.
        """
        if not trajectory_result.points or len(trajectory_result.points) < 3:
            return []

        h, w = frame_shape[:2]
        points = trajectory_result.points

        # Last 5 points for linear regression
        recent = points[-min(5, len(points)):]
        ys = np.array([p.y for p in recent])
        xs = np.array([p.x for p in recent])

        if len(np.unique(ys)) < 2:
            return []

        # Fit x = slope * y + intercept
        coeffs = np.polyfit(ys, xs, 1)
        slope, intercept = coeffs

        # Generate prediction points from impact to stump line (y=0.92 in normalised)
        last_point = points[-1]
        start_y_norm = last_point.y
        end_y_norm = 0.92  # batting crease in normalised coords

        if end_y_norm <= start_y_norm:
            return []

        n_steps = 15
        prediction = []
        for i in range(1, n_steps + 1):
            t = i / n_steps
            y_norm = start_y_norm + t * (end_y_norm - start_y_norm)
            x_norm = slope * y_norm * h + intercept
            x_norm = x_norm / w  # normalise to 0-1

            # Clamp
            x_norm = max(0.0, min(1.0, x_norm))
            y_norm = max(0.0, min(1.0, y_norm))

            prediction.append({
                "x": round(float(x_norm), 4),
                "y": round(float(y_norm), 4),
                "z": 0.0,
            })

        return prediction

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
        trajectory_result: Optional[TrajectoryPrediction] = None,
        release_idx: Optional[int] = None,
    ) -> Optional[str]:
        """Create an annotated output video with trajectory and predicted path."""
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

        det_lookup: Dict[int, dict] = {}
        for fd in per_frame_data:
            if fd["ball_detected"]:
                det_lookup[fd["frame_number"]] = fd["ball_position"]

        trajectory_xy: List[tuple] = []
        if best_track:
            smoothed = best_track.get_smoothed_trajectory(window_size=5)
            trajectory_xy = [(p.x, p.y) for p in smoothed]

        predicted_path = []
        if trajectory_result and trajectory_result.predicted_path:
            predicted_path = trajectory_result.predicted_path

        bounce_frames = set()
        if trajectory_result and trajectory_result.bounce_points:
            for bp in trajectory_result.bounce_points:
                bounce_frames.add(bp.get("frame_number", -1))

        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % frame_skip != 0:
                writer.write(frame)
                frame_idx += 1
                continue

            draw_pitch_markings(frame)

            if trajectory_xy:
                draw_trajectory_path(frame, trajectory_xy)

            # Draw predicted path from last ball position
            if predicted_path and len(trajectory_xy) > 3:
                last_pt = trajectory_xy[-1]
                for i, pp in enumerate(predicted_path[:12]):
                    px = int(last_pt[0] + pp.get("x", 0) * (i + 1) * 15)
                    py = int(last_pt[1] + pp.get("y", 0) * (i + 1) * 15)
                    if 0 <= px < w and 0 <= py < h:
                        color = (0, 255, 200) if not decision.decision.value == "OUT" else (0, 100, 255)
                        if i % 2 == 0:
                            cv2.circle(frame, (px, py), 3, color, -1)

            det = det_lookup.get(frame_idx)
            if det:
                draw_ball_glow(frame, det["x"], det["y"])
                draw_detection_box(
                    frame, det["x"], det["y"],
                    int(det["radius"]), det["confidence"]
                )

            if frame_idx in bounce_frames:
                if det:
                    cv2.circle(frame, (det["x"], det["y"]),
                               int(det["radius"]) + 8, (0, 165, 255), 2)
                    cv2.putText(frame, "PITCH", (det["x"] + 15, det["y"]),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 165, 255), 1)

            if mapper.calibration:
                _, bat_end_y = mapper.calibration.bottom_left
                cx = (mapper.calibration.bottom_left[0] +
                      mapper.calibration.bottom_right[0]) // 2
                draw_stumps(frame, cx, bat_end_y - 30)

            total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if frame_idx > total - 30:
                draw_decision_overlay(
                    frame,
                    decision.decision.value,
                    decision.dismissal_type.value,
                    decision.confidence,
                    decision.ball_speed_kmh,
                )

            draw_frame_info(frame, frame_idx, frame_idx / fps, fps)

            cv2.putText(frame, "Umpire AI v3 — Release Detection",
                        (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1)

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
        impact_idx: Optional[int] = None,
    ) -> dict:
        """Convert trajectory data into the format expected by
        :class:`DecisionEngine`."""
        data: dict = {
            "ball_speed_mps": trajectory_result.ball_speed_mps,
            "predicted_stump_hit": trajectory_result.predicted_stump_hit,
            "deviation_degrees": trajectory_result.deviation_degrees,
            "confidence": trajectory_result.confidence,
            "bounce_points": trajectory_result.bounce_points,
        }

        if trajectory_result.pitch_point:
            data["pitch_x"] = trajectory_result.pitch_point.x
            data["pitch_y"] = trajectory_result.pitch_point.y

        if trajectory_result.impact_point:
            data["impact_x"] = trajectory_result.impact_point.x
            data["impact_y"] = trajectory_result.impact_point.y

        if trajectory_result.predicted_path:
            data["predicted_path"] = trajectory_result.predicted_path

        # Detect pad impact: if the ball trajectory shows sudden change
        # near the end (batting crease zone), mark as pad impact
        data["hit_pad"] = False
        data["no_ball"] = False

        # Use velocity drop as impact indicator
        if len(per_frame_data) >= 10:
            last_20 = per_frame_data[-20:]
            ball_frames = [f for f in last_20 if f["ball_detected"]]
            if len(ball_frames) >= 5:
                # Check if ball disappears or slows down near the end
                last_five = ball_frames[-5:]
                first_five = ball_frames[:5]
                last_avg_speed = 0
                first_avg_speed = 0
                for i in range(1, len(last_five)):
                    dx = last_five[i]["ball_position"]["x"] - last_five[i-1]["ball_position"]["x"]
                    dy = last_five[i]["ball_position"]["y"] - last_five[i-1]["ball_position"]["y"]
                    last_avg_speed += np.sqrt(dx*dx + dy*dy)
                for i in range(1, len(first_five)):
                    dx = first_five[i]["ball_position"]["x"] - first_five[i-1]["ball_position"]["x"]
                    dy = first_five[i]["ball_position"]["y"] - first_five[i-1]["ball_position"]["y"]
                    first_avg_speed += np.sqrt(dx*dx + dy*dy)

                if first_avg_speed > 0 and last_avg_speed / first_avg_speed < 0.4:
                    data["hit_pad"] = True
                    data["predicted_stump_hit"] = trajectory_result.predicted_stump_hit

            # Also check deviation as a secondary signal
            if abs(trajectory_result.deviation_degrees) > 3.0 and not data["hit_pad"]:
                data["hit_pad"] = True

        if trajectory_result.bounce_points:
            last_bounce = trajectory_result.bounce_points[-1]
            if last_bounce:
                data["last_bounce_y"] = last_bounce.get("y", 0)

        return data
