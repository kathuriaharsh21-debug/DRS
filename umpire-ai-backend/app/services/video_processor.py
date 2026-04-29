"""
Video processing orchestrator — v4.

Key improvements over v3:
    - **Ball release detection**: Multi-signal approach combining size
      consistency, velocity direction, speed threshold, y-acceleration,
      and consecutive-frame validation.  Replaces the unreliable
      acceleration-based detection that still included run-up frames.
    - **Normalised prediction path**: Weighted linear + conditional
      quadratic extrapolation with bounds checking (x clamped to
      [0.1, 0.9]) and 30 sample points for smoother frontend animation.
    - **Trajectory estimation**: Defaults to linear KF with post-smoothing
      instead of UKF — the 3-D physics model is counterproductive for
      single-camera 2-D pixel data.
    - **Impact detection**: Identifies when the ball hits the batsman's pad
      by detecting sudden velocity changes near the batting crease.
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
                0.0, "Initialising v4 pipeline with multi-signal release detection"
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
                trajectory_result, per_frame_data, impact_idx,
                frame_skip=frame_skip,
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
        min_detections: int = 6,
    ) -> Optional[int]:
        """Detect ball release using a MULTI-SIGNAL approach.

        Real Hawk-Eye detects release by sudden velocity divergence from the
        bowler's body.  We approximate this with five complementary signals:

        Signal 1 — SIZE CONSISTENCY: After release the ball is a small,
            consistently-sized object (radius 3-8 px).  During run-up,
            detections may include the bowler's hand/arm (larger, variable).
        Signal 2 — VELOCITY DIRECTION: After release the ball moves DOWN
            THE PITCH (y increases rapidly).  During run-up the ball moves
            with the bowler (mostly horizontal/lateral).
        Signal 3 — SPEED THRESHOLD: After release the ball exceeds a
            minimum speed threshold (fastest-moving small object).
        Signal 4 — Y-ACCELERATION: After release the ball accelerates
            downward due to gravity.  Before release it moves at constant
            or accelerating speed toward the bowling crease.
        Signal 5 — CONSECUTIVE CONSISTENT FRAMES: At least N frames AFTER
            the candidate must also show ball-like properties.

        Algorithm
        ---------
        1.  Compute per-frame speed, size, y-velocity from detections.
        2.  For each candidate frame (within the first 60 %) check ALL:
            * speed  > median speed
            * y-velocity > 0  (moving toward batsman)
            * radius < median + 1 std  (small and consistent)
        3.  Validate the candidate by confirming that the next 3-4 frames
            also satisfy these conditions.
        4.  Fallback: pick the frame with highest speed in the first 60 %.

        Returns index into the detections list, or None if indeterminate.
        """
        if len(detections) < min_detections:
            return None

        n = len(detections)

        # --------------------------------------------------------------
        # Step 1: Compute per-frame metrics
        # --------------------------------------------------------------
        speeds: List[float] = []          # scalar speed per frame transition
        y_velocities: List[float] = []    # dy per frame transition
        radii: List[float] = [detections[0]["radius"]]

        for i in range(1, n):
            dx = detections[i]["x"] - detections[i - 1]["x"]
            dy = detections[i]["y"] - detections[i - 1]["y"]
            dt = max(detections[i]["timestamp"] - detections[i - 1]["timestamp"], 1e-6)
            speeds.append(float(np.sqrt(dx * dx + dy * dy)) / dt)
            y_velocities.append(dy / dt)
            radii.append(detections[i]["radius"])

        if len(speeds) < 3:
            return 0

        # Statistics over the full detection set
        median_speed = float(np.median(speeds))
        radii_arr = np.array(radii, dtype=np.float64)
        median_radius = float(np.median(radii_arr))
        std_radius = float(np.std(radii_arr))
        radius_upper = median_radius + std_radius

        logger.debug(
            "Release detection stats: median_speed=%.1f, median_radius=%.1f, "
            "std_radius=%.1f, radius_upper=%.1f",
            median_speed, median_radius, std_radius, radius_upper,
        )

        # --------------------------------------------------------------
        # Step 2: Score each candidate frame
        # --------------------------------------------------------------
        # speeds[i] corresponds to the transition from detection i to i+1,
        # so we test detection index (i+1) as the candidate release frame.
        search_limit = int(n * 0.60)
        validate_window = min(4, len(speeds) - 1)

        best_candidate: Optional[int] = None

        for i in range(min(search_limit - 1, len(speeds) - validate_window)):
            candidate_idx = i + 1  # detection index after the transition

            # Signal 1: SIZE — must be small and consistent
            if radii[candidate_idx] > radius_upper:
                continue

            # Signal 2: VELOCITY DIRECTION — y must be increasing (down the pitch)
            if y_velocities[i] <= 0:
                continue

            # Signal 3: SPEED THRESHOLD — must be above median
            if speeds[i] <= median_speed:
                continue

            # Signal 4: Y-ACCELERATION — check that y-velocity is positive
            # and growing compared to the previous frame
            y_accel_ok = True
            if i >= 1 and y_velocities[i - 1] <= 0:
                # y-velocity went from non-positive to positive — good
                y_accel_ok = True
            elif i >= 1 and y_velocities[i] < y_velocities[i - 1]:
                # y-velocity decreased — might not be genuine release
                y_accel_ok = False

            if not y_accel_ok:
                continue

            # Signal 5: CONSECUTIVE VALIDATION — next N frames must also qualify
            consecutive_ok = True
            for j in range(1, validate_window + 1):
                check_speed_idx = i + j
                check_det_idx = candidate_idx + j
                if check_speed_idx >= len(speeds) or check_det_idx >= n:
                    break
                # Subsequent frames must still be moving down-pitch
                if y_velocities[check_speed_idx] <= 0:
                    consecutive_ok = False
                    break
                # Subsequent frames must stay small
                if radii[check_det_idx] > radius_upper * 1.2:
                    consecutive_ok = False
                    break

            if consecutive_ok:
                best_candidate = candidate_idx
                logger.debug(
                    "Release candidate found at det_idx=%d (speed=%.1f, "
                    "y_vel=%.1f, radius=%.1f)",
                    candidate_idx, speeds[i], y_velocities[i],
                    radii[candidate_idx],
                )
                break  # take the earliest qualifying frame

        # --------------------------------------------------------------
        # Step 3: Fallback — highest speed in first 60 %
        # --------------------------------------------------------------
        if best_candidate is None:
            peak_speed_idx = int(np.argmax(speeds[:min(search_limit, len(speeds))]))
            best_candidate = peak_speed_idx + 1
            logger.info(
                "Release detection: fallback to highest-speed frame at det_idx=%d "
                "(speed=%.1f)",
                best_candidate, speeds[peak_speed_idx],
            )
        else:
            logger.info(
                "Release detection: multi-signal at det_idx=%d "
                "(speed=%.1f, y_vel=%.1f, radius=%.1f)",
                best_candidate,
                speeds[max(best_candidate - 1, 0)],
                y_velocities[max(best_candidate - 1, 0)],
                radii[best_candidate],
            )

        return min(best_candidate, n - 1)

    # ------------------------------------------------------------------
    # Impact detection
    # ------------------------------------------------------------------

    @staticmethod
    def _detect_impact_frame(
        detections: List[Dict[str, Any]],
        release_idx: Optional[int],
        frame_height: int,
    ) -> Optional[int]:
        """Detect ball impact with batsman's pad.
    
        Impact is characterized by:
        1. Sudden DECELERATION (ball hits pad and slows/stops)
        2. Ball is in lower portion of frame (near batsman)
        3. After impact, ball may disappear or move erratically
    
        Strategy: Walk forward from release, find first significant speed drop
        that persists for multiple frames.
    
        Returns index into the detections list, or None.
        """
        if len(detections) < 5:
            return None
    
        start_idx = release_idx if release_idx is not None else 0
        if start_idx >= len(detections) - 3:
            return len(detections) - 1
    
        post_release = detections[start_idx:]
        if len(post_release) < 4:
            return len(detections) - 1
    
        # Compute speeds
        speeds = []
        for i in range(1, len(post_release)):
            dx = post_release[i]["x"] - post_release[i-1]["x"]
            dy = post_release[i]["y"] - post_release[i-1]["y"]
            dt = max(post_release[i]["timestamp"] - post_release[i-1]["timestamp"], 1e-6)
            speed = float(np.sqrt(dx*dx + dy*dy)) / dt
            speeds.append(speed)
    
        if not speeds:
            return len(detections) - 1
    
        # Smooth speeds
        win = min(3, max(2, len(speeds) // 4))
        if win > 1:
            kernel = np.ones(win) / win
            smoothed = np.convolve(speeds, kernel, mode='same').tolist()
        else:
            smoothed = speeds
    
        median_speed = float(np.median(speeds))
        if median_speed < 10:
            return len(detections) - 1
    
        # Find where speed drops below 40% of median (after first reaching high speed)
        reached_high_speed = False
        for i in range(len(smoothed)):
            if smoothed[i] > median_speed * 0.7:
                reached_high_speed = True
            if reached_high_speed and smoothed[i] < median_speed * 0.35:
                # Found impact - this is where ball hits pad
                return start_idx + i
    
        # Fallback: last detection
        return len(detections) - 1

    # ------------------------------------------------------------------
    # Normalised prediction path for frontend
    # ------------------------------------------------------------------

    @staticmethod
    def _build_normalised_prediction(
        trajectory_result: TrajectoryPrediction,
        frame_shape: Tuple[int, ...],
    ) -> List[Dict[str, float]]:
        """Build normalised prediction path from impact point to stumps.

        Uses a **weighted combination** of linear and (optionally) quadratic
        extrapolation from the last segment of the trajectory.  This avoids
        the wild curves that pure quadratic fits can produce when the data
        is sparse or noisy.

        Rules:
        * Linear fit is always computed (stable baseline).
        * Quadratic component is blended in only when we have 8+ points AND
          the quadratic coefficient is small enough (|a| < 0.5) to be
          trustworthy.
        * Predicted x is clamped to [0.1, 0.9] — the ball cannot leave
          the frame.
        * 30 sample points are generated for smooth frontend animation.
        """
        if not trajectory_result.points or len(trajectory_result.points) < 4:
            return []

        points = trajectory_result.points

        # Use last N points for extrapolation (post-bounce trajectory)
        n_fit = min(8, max(4, len(points) // 2))
        recent = points[-n_fit:]

        ys = np.array([p.y for p in recent])
        xs = np.array([p.x for p in recent])

        if len(np.unique(ys)) < 2:
            return []

        # --- Linear fit (always available) ---
        try:
            lin_coeffs = np.polyfit(ys, xs, 1)   # [slope, intercept]
        except (np.linalg.LinAlgError, ValueError):
            return []

        # --- Quadratic fit (conditional) ---
        use_quadratic = False
        quad_coeffs = None
        if len(recent) >= 8:
            try:
                qc = np.polyfit(ys, xs, 2)  # [a, b, c]
                if abs(qc[0]) < 0.5:          # reasonable curvature
                    quad_coeffs = qc
                    use_quadratic = True
            except (np.linalg.LinAlgError, ValueError):
                pass

        # --- Generate prediction points ---
        last_point = points[-1]
        start_y = last_point.y
        end_y = 0.95  # stump line in normalised coords

        if end_y <= start_y:
            return []

        n_steps = 30
        prediction: List[Dict[str, float]] = []
        for i in range(1, n_steps + 1):
            t = i / n_steps
            y_norm = start_y + t * (end_y - start_y)

            # Weighted blend: quadratic contribution grows from 0 to 0.4
            # as we move further from the last known point.
            quad_weight = 0.4 if use_quadratic else 0.0
            x_lin = float(np.polyval(lin_coeffs, y_norm))
            x_quad = float(np.polyval(quad_coeffs, y_norm)) if use_quadratic else x_lin

            x_norm = (1.0 - quad_weight) * x_lin + quad_weight * x_quad

            # Clamp to valid range — ball can't go off-screen
            x_norm = max(0.1, min(0.9, x_norm))
            y_norm = max(0.0, min(1.0, y_norm))

            prediction.append({
                "x": round(x_norm, 4),
                "y": round(y_norm, 4),
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

            cv2.putText(frame, "Umpire AI v4 — Multi-Signal Release Detection",
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
        frame_skip: int = 2,
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

        # Detect pad impact more reliably
        data["hit_pad"] = False
        data["no_ball"] = False
    
        if len(per_frame_data) >= 8:
            # Get all frames after release
            post_release_frames = per_frame_data[max(0, impact_idx * frame_skip):] if impact_idx else per_frame_data
            ball_frames = [f for f in post_release_frames if f["ball_detected"]]
        
            if len(ball_frames) >= 5:
                # Check if ball speed drops significantly in last 30% of trajectory
                # (indicating impact with pad/body)
                cutoff = max(1, len(ball_frames) * 7 // 10)
                early = ball_frames[:cutoff]
                late = ball_frames[cutoff:]
        
                if len(early) >= 2 and len(late) >= 2:
                    early_speed = 0
                    late_speed = 0
                    for i in range(1, len(early)):
                        dx = early[i]["ball_position"]["x"] - early[i-1]["ball_position"]["x"]
                        dy = early[i]["ball_position"]["y"] - early[i-1]["ball_position"]["y"]
                        early_speed += np.sqrt(dx*dx + dy*dy)
                    for i in range(1, len(late)):
                        dx = late[i]["ball_position"]["x"] - late[i-1]["ball_position"]["x"]
                        dy = late[i]["ball_position"]["y"] - late[i-1]["ball_position"]["y"]
                        late_speed += np.sqrt(dx*dx + dy*dy)
        
                    if early_speed > 0 and late_speed / max(early_speed, 1) < 0.35:
                        data["hit_pad"] = True
                        data["predicted_stump_hit"] = trajectory_result.predicted_stump_hit

        if trajectory_result.bounce_points:
            last_bounce = trajectory_result.bounce_points[-1]
            if last_bounce:
                data["last_bounce_y"] = last_bounce.get("y", 0)

        return data
