"""
Video processing orchestrator — v2.

Coordinates the **hybrid computer-vision pipeline**:

    **Tier 1 (GPU-accelerated):**
        1. YOLOv11 + P2 head for ball detection (tiny, fast-moving objects)
        2. BoT-SORT for multi-frame tracking (CMC + NIC)
        3. UKF with physics model for trajectory prediction (gravity + drag + bounce)
        4. Perspective-transform pitch mapping with improved auto-calibration
        5. ICC rules decision engine

    **Tier 2 (CPU fallback):**
        1. HSV colour segmentation + MOG2 for ball detection
        2. Hungarian-algorithm-based tracker
        3. Linear Kalman filter for trajectory smoothing
        4. Same pitch mapping and decision engine

    10. Return comprehensive JSON results with predicted path
"""

import time
import logging
import uuid
from pathlib import Path
from typing import Optional, Dict, List, Any, Callable

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
    """Orchestrates the entire cricket-ball analysis pipeline (v2).

    Automatically selects the best available detection/tracking/trajectory
    tier based on installed packages and available hardware.

    Usage::

        processor = VideoProcessor(settings)
        result = processor.process(video_path, job_id)
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
        """Process a video and return the full analysis result.

        Args:
            video_path: Absolute path to the uploaded video file.
            job_id: Unique job identifier.
            ball_type: ``"red"``, ``"white"``, or ``"pink"``.
            frame_skip: Process every Nth frame.
            auto_calibrate: Attempt automatic pitch-line detection.
            calibration: Manual calibration dict.
            callbacks: Optional callbacks for progress reporting.

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
                0.0, "Initialising v2 hybrid pipeline"
            )

            # === Determine active tiers ===
            detection_tier = self.settings.detection_tier
            tracking_tier = self.settings.tracking_tier
            use_ukf = self.settings.use_ukf

            # --- Initialise detector (hybrid: YOLO + HSV fallback) ---
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

            # --- Initialise tracker (hybrid: BoT-SORT + Hungarian) ---
            tracker = BallTracker(
                tracking_tier=tracking_tier,
                max_distance=self.settings.tracker_max_distance,
                max_missing_frames=self.settings.tracker_max_missing_frames,
            )

            # --- Initialise trajectory estimator (UKF or linear KF) ---
            estimator = TrajectoryEstimator(
                dt=1.0 / max(fps, 1.0),
                use_ukf=use_ukf,
            )

            # --- Pitch mapper and decision engine ---
            mapper = PitchMapper()
            engine = DecisionEngine()

            logger.info(
                "Pipeline tiers: detection=%s, tracking=%s, trajectory=%s",
                detector.active_tier, tracker.active_tier, estimator.filter_type,
            )

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
                    logger.info("Auto-calibration successful")
                else:
                    logger.warning(
                        "Auto-calibration failed — using default frame mapping"
                    )

            # === Frame-by-frame processing ===
            per_frame_data: List[Dict[str, Any]] = []
            all_trajectory_points: List[tuple] = []
            frames_with_ball = 0
            processed_count = 0
            yolo_track_ids: set = set()  # Track IDs from YOLO+BoT-SORT

            frame_gen = extract_frames(
                video_path,
                target_fps=self.settings.fps_target,
                frame_skip=frame_skip,
            )

            # If using YOLO detection tier, attempt end-to-end tracking
            use_yolo_tracking = (
                detection_tier in ("auto", "yolo")
                and tracking_tier in ("auto", "botsort")
            )

            for frame, frame_number, timestamp in frame_gen:
                # Detect ball
                detections: List[BallDetection] = detector.detect(
                    frame, frame_number, timestamp
                )

                # Update tracker
                tracker.update(detections, frame_number, timestamp, frame)

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
                    "detection_tier": detector.active_tier,
                    "tracking_tier": tracker.active_tier,
                }
                per_frame_data.append(frame_data)

                processed_count += 1

                # Progress
                progress = min(processed_count / max(total_frames, 1), 1.0)
                callbacks.on_progress and callbacks.on_progress(
                    progress,
                    f"[{detector.active_tier}/{tracker.active_tier}] "
                    f"Frame {frame_number}/{total_frames} "
                    f"({frames_with_ball} with ball)",
                )
                callbacks.on_frame and callbacks.on_frame(frame_number, frame_data)

            # === Trajectory estimation ===
            callbacks.on_progress and callbacks.on_progress(
                0.85,
                f"Running trajectory estimation ({estimator.filter_type})"
            )
            trajectory_result: TrajectoryPrediction = estimator.estimate(
                frame_shape=first_frame.shape
            )

            # === Build trajectory data for decision engine ===
            trajectory_data = self._build_trajectory_data(
                trajectory_result, per_frame_data
            )

            # === Decision engine ===
            callbacks.on_progress and callbacks.on_progress(
                0.92, "Running decision engine"
            )
            decision: DecisionResult = engine.analyze(
                trajectory_data,
                frame_shape=first_frame.shape[:2],
            )

            # === Generate annotated video ===
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
            )

            # === Compile results ===
            processing_time = time.time() - start_time

            result = {
                "job_id": job_id,
                "video_info": video_info,
                "ball_type": ball_type,
                # Pipeline info
                "pipeline": {
                    "detection_tier": detector.active_tier,
                    "tracking_tier": tracker.active_tier,
                    "trajectory_filter": estimator.filter_type,
                },
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
                "bounce_points": trajectory_result.bounce_points,
                "predicted_path": trajectory_result.predicted_path,
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
    # Annotated video generation (v2 — includes predicted path)
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

        # Build detection lookup
        det_lookup: Dict[int, dict] = {}
        for fd in per_frame_data:
            if fd["ball_detected"]:
                det_lookup[fd["frame_number"]] = fd["ball_position"]

        # Collect full trajectory points
        trajectory_xy: List[tuple] = []
        if best_track:
            smoothed = best_track.get_smoothed_trajectory(window_size=5)
            trajectory_xy = [(p.x, p.y) for p in smoothed]

        # Predicted path for LBW visualization
        predicted_path = []
        if trajectory_result and trajectory_result.predicted_path:
            predicted_path = trajectory_result.predicted_path

        # Bounce points
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

            # Draw pitch markings
            draw_pitch_markings(frame)

            # Draw trajectory up to current frame
            if trajectory_xy:
                draw_trajectory_path(frame, trajectory_xy)

            # Draw predicted future path (dashed line)
            if predicted_path and len(trajectory_xy) > 5:
                last_pt = trajectory_xy[-1]
                for i, pp in enumerate(predicted_path[:10]):
                    alpha = max(0.3, 1.0 - i * 0.07)
                    px = int(last_pt[0] + pp.get("x", 0) * (i + 1) * 20)
                    py = int(last_pt[1] + pp.get("y", 0) * (i + 1) * 20)
                    if 0 <= px < w and 0 <= py < h:
                        color = (0, 255, 200)  # cyan for predicted
                        if i % 2 == 0:  # dashed effect
                            cv2.circle(frame, (px, py), 3, color, -1)
                            cv2.putText(
                                frame, str(i + 1), (px + 5, py - 5),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.3, color, 1,
                            )

            # Draw ball position
            det = det_lookup.get(frame_idx)
            if det:
                draw_ball_glow(frame, det["x"], det["y"])
                draw_detection_box(
                    frame, det["x"], det["y"],
                    int(det["radius"]), det["confidence"]
                )

            # Mark bounce points
            if frame_idx in bounce_frames:
                if det:
                    cv2.circle(
                        frame,
                        (det["x"], det["y"]),
                        int(det["radius"]) + 8,
                        (0, 165, 255), 2,  # orange ring
                    )
                    cv2.putText(
                        frame, "PITCH", (det["x"] + 15, det["y"]),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 165, 255), 1,
                    )

            # Draw stumps at batting end
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

            # Draw frame info with pipeline info
            draw_frame_info(frame, frame_idx, frame_idx / fps, fps)

            # Draw pipeline tier badge
            cv2.putText(
                frame, f"Detection: {self.settings.detection_tier}",
                (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1,
            )
            cv2.putText(
                frame, f"Tracking: {self.settings.tracking_tier}",
                (10, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1,
            )
            cv2.putText(
                frame, f"Filter: {'UKF+Physics' if self.settings.use_ukf else 'Linear KF'}",
                (10, 70), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (200, 200, 200), 1,
            )

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
            "bounce_points": trajectory_result.bounce_points,
        }

        if trajectory_result.pitch_point:
            data["pitch_x"] = trajectory_result.pitch_point.x
            data["pitch_y"] = trajectory_result.pitch_point.y

        if trajectory_result.impact_point:
            data["impact_x"] = trajectory_result.impact_point.x
            data["impact_y"] = trajectory_result.impact_point.y

        # Predicted path for "would hit stumps" analysis
        if trajectory_result.predicted_path:
            data["predicted_path"] = trajectory_result.predicted_path

        # Heuristic: determine if ball hit pad vs went through to stumps
        last_pts = per_frame_data[-10:] if per_frame_data else []
        data["hit_pad"] = False
        data["no_ball"] = False

        # If deviation is large (>5 deg), ball likely hit pad
        if abs(trajectory_result.deviation_degrees) > 5.0:
            data["hit_pad"] = True
            data["predicted_stump_hit"] = trajectory_result.predicted_stump_hit

        # Check for bounce points near stumps for bowled detection
        if trajectory_result.bounce_points:
            last_bounce = trajectory_result.bounce_points[-1]
            if last_bounce:
                data["last_bounce_y"] = last_bounce.get("y", 0)

        return data
