"""
Motion-aware, pose-guided ball release detector — v1.

Uses a **spatio-temporal stack approach** to identify the precise frame where
the bowler releases the ball.  The pipeline proceeds through three tiers of
sophistication:

    **Tier 1 — Pose-guided detection (most accurate):**
    Pose estimation locates the bowler's bowling hand.  A velocity-dependent
    distance threshold is applied to the ball-hand separation; release is
    signalled when the ball first exceeds this threshold and the hand begins
    to decelerate.

    **Tier 2 — Spatio-temporal motion streak detection:**
    When pose data is unavailable, the last *N* frames are stacked into a
    3-channel "motion volume".  Frame differences highlight moving objects,
    and contour analysis detects elongated motion streaks that appear when
    the fast-moving ball separates from the bowler silhouette.

    **Tier 3 — Multi-signal fallback:**
    The existing :meth:`VideoProcessor._detect_release_frame` logic
    (size consistency, velocity direction, speed threshold, y-acceleration,
    consecutive validation) is used as a last resort.

The ``ReleaseDetector`` maintains internal state across frames (frame buffer,
pose history, distance tracking) and returns a :class:`ReleaseEvent` with
full provenance information.
"""

import numpy as np
import cv2
from collections import deque
from dataclasses import dataclass
from typing import Optional, List, Dict, Any, Tuple
import logging

from app.core.ball_detector import BallDetector, BallDetection
from app.core.pose_estimator import (
    PoseEstimator,
    PoseResult,
    compute_hand_velocity,
    get_dynamic_roi,
)

logger = logging.getLogger(__name__)


# ======================================================================
# Data classes
# ======================================================================

@dataclass
class ReleaseEvent:
    """Ball release event with supporting evidence.

    Attributes:
        frame_number: Sequential frame index where release was detected.
        timestamp: Elapsed video time in seconds.
        ball_x: Horizontal centre of the ball at release (pixels).
        ball_y: Vertical centre of the ball at release (pixels).
        hand_x: Hand x-coordinate at release, if pose-guided.
        hand_y: Hand y-coordinate at release, if pose-guided.
        ball_speed: Ball speed at release in pixels/second.
        hand_speed: Hand speed at release in pixels/second.
        ball_hand_distance: Ball-to-hand distance at release in pixels.
        confidence: Detection confidence in [0, 1].
        method: Detection method used — ``"pose_guided"``,
            ``"spatiotemporal"``, or ``"multi_signal_fallback"``.
    """
    frame_number: int
    timestamp: float
    ball_x: float
    ball_y: float
    hand_x: Optional[float] = None
    hand_y: Optional[float] = None
    ball_speed: float = 0.0
    hand_speed: float = 0.0
    ball_hand_distance: float = 0.0
    confidence: float = 0.0
    method: str = "pose_guided"


# ======================================================================
# Internal tracking data class
# ======================================================================

@dataclass
class _FrameTrackingState:
    """Per-frame tracking state for ball-hand distance analysis."""
    frame_number: int
    timestamp: float
    ball_x: Optional[float] = None
    ball_y: Optional[float] = None
    hand_x: Optional[float] = None
    hand_y: Optional[float] = None
    ball_hand_distance: float = 0.0
    hand_speed: float = 0.0
    ball_speed: float = 0.0


# ======================================================================
# Main detector
# ======================================================================

class ReleaseDetector:
    """Motion-aware, pose-guided ball release detector.

    Pipeline:
        1. Maintain a frame buffer of the last *stack_size* frames.
        2. For each frame:
           a. Run pose estimation → get hand position.
           b. Compute dynamic ROI around hand.
           c. Run ball detection within the ROI (spatio-temporal stack).
           d. Track ball-hand distance over time.
           e. Detect release when distance exceeds threshold.
        3. If pose is unavailable, fall back to spatio-temporal motion analysis.
        4. If that fails too, fall back to the existing multi-signal approach.

    Usage::

        detector = ReleaseDetector(ball_detector, pose_estimator=pose_est)
        for frame, fn, ts in frame_gen:
            event = detector.process_frame(frame, fn, ts)
            if event:
                print(f"Release at frame {event.frame_number}")
    """

    def __init__(
        self,
        ball_detector: BallDetector,
        pose_estimator: Optional[PoseEstimator] = None,
        stack_size: int = 3,
        min_hand_confidence: float = 0.3,
        velocity_threshold_low: float = 200.0,
        velocity_threshold_high: float = 80.0,
        consecutive_validation: int = 3,
    ):
        """Initialise the release detector.

        Args:
            ball_detector: The existing :class:`BallDetector` instance.
            pose_estimator: Optional :class:`PoseEstimator` for hand tracking.
            stack_size: Number of frames in the spatio-temporal stack (default 3).
            min_hand_confidence: Minimum pose confidence to use hand position.
            velocity_threshold_low: Ball-hand distance threshold when hand is
                moving slowly (px).
            velocity_threshold_high: Ball-hand distance threshold when hand is
                moving fast (px).
            consecutive_validation: Number of consecutive frames to validate
                after a candidate release.
        """
        self.ball_detector = ball_detector
        self.pose_estimator = pose_estimator
        self.stack_size = stack_size
        self.min_hand_confidence = min_hand_confidence
        self.velocity_threshold_low = velocity_threshold_low
        self.velocity_threshold_high = velocity_threshold_high
        self.consecutive_validation = consecutive_validation

        # Frame buffer for spatio-temporal stacking (grayscale)
        self._frame_buffer: deque = deque(maxlen=stack_size)

        # Pose history for velocity computation (~10 recent results)
        self._pose_history: List[PoseResult] = []

        # Ball-hand distance tracking state
        self._tracking_history: List[_FrameTrackingState] = []
        self._max_tracking_history: int = 30

        # Previous ball detection for speed computation
        self._prev_detection: Optional[BallDetection] = None

        # Release validation state
        self._candidate_release: Optional[ReleaseEvent] = None
        self._validation_count: int = 0
        self._release_found: bool = False

        # Stored results for the public API
        self._pose_guided_release: Optional[ReleaseEvent] = None
        self._spatiotemporal_release: Optional[ReleaseEvent] = None

        logger.info(
            "ReleaseDetector initialised (pose=%s, stack_size=%d, "
            "threshold=[%.0f, %.0f])",
            pose_estimator is not None,
            stack_size,
            velocity_threshold_low,
            velocity_threshold_high,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def process_frame(
        self,
        frame: np.ndarray,
        frame_number: int,
        timestamp: float,
    ) -> Optional[ReleaseEvent]:
        """Process a single frame and check for release.

        Maintains internal state (frame buffer, pose history, etc.).
        Returns :class:`ReleaseEvent` when release is detected, ``None``
        otherwise.

        Args:
            frame: BGR image from ``cv2.VideoCapture``.
            frame_number: Sequential frame index.
            timestamp: Elapsed time in seconds.

        Returns:
            :class:`ReleaseEvent` on the first release frame, ``None``
            otherwise.
        """
        if self._release_found:
            return None

        if frame is None or frame.size == 0:
            return None

        # Update frame buffer (convert to grayscale for motion computation)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)
        self._frame_buffer.append(gray)

        # --- Pose estimation ---
        pose_result: Optional[PoseResult] = None
        if self.pose_estimator is not None:
            pose_result = self.pose_estimator.estimate(
                frame, frame_number, timestamp
            )
            if pose_result is not None:
                self._pose_history.append(pose_result)
                # Trim history to avoid unbounded growth
                if len(self._pose_history) > 15:
                    self._pose_history = self._pose_history[-15:]

        # --- Ball detection ---
        detections: List[BallDetection] = self.ball_detector.detect(
            frame, frame_number, timestamp
        )

        # --- Attempt pose-guided release detection (Tier 1) ---
        if pose_result is not None and detections:
            event = self._detect_release_pose_guided(
                frame, detections, pose_result, frame_number, timestamp,
            )
            if event is not None:
                self._release_found = True
                self._pose_guided_release = event
                logger.info(
                    "Release detected (pose-guided) at frame %d, "
                    "confidence=%.2f, ball_hand_dist=%.1f",
                    frame_number, event.confidence, event.ball_hand_distance,
                )
                return event

        # --- Spatio-temporal fallback (Tier 2) ---
        if len(self._frame_buffer) >= self.stack_size and not detections:
            event = self._detect_release_spatiotemporal(
                frame, frame_number, timestamp,
            )
            if event is not None:
                self._release_found = True
                self._spatiotemporal_release = event
                logger.info(
                    "Release detected (spatiotemporal) at frame %d, "
                    "confidence=%.2f",
                    frame_number, event.confidence,
                )
                return event

        # Update previous detection for speed tracking
        if detections:
            self._prev_detection = detections[0]

        return None

    def get_release_frame(
        self,
        detections: List[Dict[str, Any]],
        frame_height: int,
    ) -> Optional[int]:
        """Public API: returns the release frame index from processed detections.

        Uses the best available method:
            1. If pose-guided release was found → return that.
            2. If spatio-temporal release was found → return that.
            3. Fall back to multi-signal approach.

        Args:
            detections: Raw detection dicts (same format as
                :meth:`VideoProcessor._detect_release_frame`).
            frame_height: Frame height in pixels.

        Returns:
            Index into *detections* or ``None``.
        """
        # Prefer pose-guided
        if self._pose_guided_release is not None:
            release_frame = self._pose_guided_release.frame_number
            for i, d in enumerate(detections):
                if d.get("frame_number") == release_frame:
                    return i
            # If exact frame not found, find the closest
            return self._find_closest_detection_index(
                detections, release_frame
            )

        # Spatio-temporal
        if self._spatiotemporal_release is not None:
            release_frame = self._spatiotemporal_release.frame_number
            return self._find_closest_detection_index(
                detections, release_frame
            )

        # Multi-signal fallback
        return self._fallback_multi_signal(detections, frame_height)

    def reset(self) -> None:
        """Reset all internal state for a new video/sequence."""
        self._frame_buffer.clear()
        self._pose_history.clear()
        self._tracking_history.clear()
        self._prev_detection = None
        self._candidate_release = None
        self._validation_count = 0
        self._release_found = False
        self._pose_guided_release = None
        self._spatiotemporal_release = None

    # ------------------------------------------------------------------
    # Tier 1: Pose-guided release detection
    # ------------------------------------------------------------------

    def _detect_release_pose_guided(
        self,
        frame: np.ndarray,
        detections: List[BallDetection],
        pose_result: PoseResult,
        frame_number: int,
        timestamp: float,
    ) -> Optional[ReleaseEvent]:
        """Pose-guided release detection.

        1. Get hand position from pose.
        2. If hand detected with sufficient confidence:
           a. Compute distance from each detection to hand.
           b. Track distance over recent frames.
           c. Release = distance exceeds velocity-dependent threshold.
        3. Also check: hand velocity drops after release (hand decelerates).
        """
        if pose_result.hand_position is None:
            return None
        if pose_result.hand_confidence < self.min_hand_confidence:
            return None
        if not detections:
            return None

        hand_x, hand_y = pose_result.hand_position

        # Compute hand velocity from pose history
        _, _, hand_speed = compute_hand_velocity(
            self._pose_history, window=3,
        )

        # Compute velocity-dependent threshold
        threshold = self._compute_velocity_threshold(hand_speed)

        # Find the detection closest to the predicted release trajectory
        best_det: Optional[BallDetection] = None
        best_dist = float("inf")
        for det in detections:
            dx = det.x - hand_x
            dy = det.y - hand_y
            dist = float(np.sqrt(dx * dx + dy * dy))
            if dist < best_dist:
                best_dist = dist
                best_det = det

        if best_det is None:
            return None

        # Compute ball speed from previous detection
        ball_speed = 0.0
        if self._prev_detection is not None:
            dt = max(timestamp - self._prev_detection.timestamp, 1e-6)
            dx = best_det.x - self._prev_detection.x
            dy = best_det.y - self._prev_detection.y
            ball_speed = float(np.sqrt(dx * dx + dy * dy)) / dt

        # Record tracking state
        state = _FrameTrackingState(
            frame_number=frame_number,
            timestamp=timestamp,
            ball_x=float(best_det.x),
            ball_y=float(best_det.y),
            hand_x=hand_x,
            hand_y=hand_y,
            ball_hand_distance=best_dist,
            hand_speed=hand_speed,
            ball_speed=ball_speed,
        )
        self._tracking_history.append(state)
        if len(self._tracking_history) > self._max_tracking_history:
            self._tracking_history = self._tracking_history[-self._max_tracking_history:]

        # Need at least 3 tracking points before we can make a decision
        if len(self._tracking_history) < 3:
            return None

        # --- Check release criteria ---

        # Criterion 1: Ball-hand distance exceeds velocity-dependent threshold
        distance_exceeded = best_dist > threshold

        # Criterion 2: Distance is increasing (ball moving away from hand)
        distance_increasing = True
        if len(self._tracking_history) >= 2:
            prev_dist = self._tracking_history[-2].ball_hand_distance
            distance_increasing = best_dist > prev_dist

        # Criterion 3: Hand is decelerating (or at least not accelerating)
        #   After release the hand slows down as the ball carries momentum.
        hand_decelerating = True
        if len(self._tracking_history) >= 3:
            # Compare average hand speed in recent window vs earlier window
            recent_window = self._tracking_history[-3:]
            earlier_speeds = [
                s.hand_speed for s in self._tracking_history[:-3][-3:]
            ]
            if earlier_speeds:
                recent_avg = sum(s.hand_speed for s in recent_window) / len(recent_window)
                earlier_avg = sum(earlier_speeds) / len(earlier_speeds)
                hand_decelerating = recent_avg < earlier_avg * 1.1

        # Criterion 4: Ball speed is significantly higher than hand speed
        #   (ball has been released and is flying freely)
        ball_faster = ball_speed > hand_speed * 1.3 if hand_speed > 10 else True

        # Combine criteria
        criteria_met = sum([
            distance_exceeded,
            distance_increasing,
            hand_decelerating,
            ball_faster,
        ])

        # Require at least 3 of 4 criteria
        if criteria_met >= 3:
            # Compute confidence based on how strongly the criteria are met
            dist_ratio = best_dist / max(threshold, 1.0)
            dist_conf = min(dist_ratio / 2.0, 1.0)  # 0-1 based on distance/threshold

            speed_ratio = ball_speed / max(hand_speed, 1.0) if hand_speed > 0 else 2.0
            speed_conf = min(speed_ratio / 3.0, 1.0)

            # Weight by number of criteria met
            criteria_weight = criteria_met / 4.0
            confidence = round(criteria_weight * 0.4 + dist_conf * 0.3 + speed_conf * 0.3, 3)
            confidence = min(max(confidence, 0.1), 1.0)

            return ReleaseEvent(
                frame_number=frame_number,
                timestamp=timestamp,
                ball_x=float(best_det.x),
                ball_y=float(best_det.y),
                hand_x=hand_x,
                hand_y=hand_y,
                ball_speed=round(ball_speed, 1),
                hand_speed=round(hand_speed, 1),
                ball_hand_distance=round(best_dist, 1),
                confidence=confidence,
                method="pose_guided",
            )

        return None

    # ------------------------------------------------------------------
    # Tier 2: Spatio-temporal motion streak detection
    # ------------------------------------------------------------------

    def _detect_release_spatiotemporal(
        self,
        frame: np.ndarray,
        frame_number: int,
        timestamp: float,
    ) -> Optional[ReleaseEvent]:
        """Spatio-temporal motion streak detection.

        When pose is unavailable, detect release by:
            1. Stack last 3 frames into a 3-channel "motion volume".
            2. Compute frame differences to highlight moving objects.
            3. Detect motion streaks (elongated bright regions in difference).
            4. The ball creates a distinctive motion streak at release.
            5. Release = first frame where a fast-moving small object
               separates from the larger bowler silhouette.
        """
        motion_stack = self._build_motion_stack()
        if motion_stack is None:
            return None

        streak = self._detect_motion_streak(motion_stack)
        if streak is None:
            return None

        sx, sy = streak["x"], streak["y"]
        speed = streak["speed"]
        streak_conf = streak["confidence"]

        # Only consider streaks in the upper portion of the frame
        # (release happens in the bowling crease area)
        frame_h, frame_w = frame.shape[:2]
        if sy > frame_h * 0.6:
            return None

        # Only consider fast-moving streaks (ball was recently released)
        if speed < 50:
            return None

        # Compute a confidence score
        confidence = round(min(streak_conf * speed / 300.0, 1.0), 3)
        confidence = min(max(confidence, 0.1), 0.8)  # cap at 0.8 for ST method

        return ReleaseEvent(
            frame_number=frame_number,
            timestamp=timestamp,
            ball_x=float(sx),
            ball_y=float(sy),
            hand_x=None,
            hand_y=None,
            ball_speed=round(speed, 1),
            hand_speed=0.0,
            ball_hand_distance=0.0,
            confidence=confidence,
            method="spatiotemporal",
        )

    def _build_motion_stack(self) -> Optional[np.ndarray]:
        """Build a spatio-temporal motion stack from the frame buffer.

        Returns a 3-channel image where each channel is a frame difference:
            - Channel 0: ``frame[t-2] - frame[t-1]``
            - Channel 1: ``frame[t-1] - frame[t]``
            - Channel 2: accumulated absolute difference

        All normalised to 0–255.  Uses NumPy vectorized operations.

        Returns:
            3-channel ``np.uint8`` image or ``None`` if insufficient frames.
        """
        frames = list(self._frame_buffer)
        if len(frames) < 3:
            return None

        # Compute consecutive frame differences
        diff_0 = cv2.absdiff(frames[0], frames[1])   # t-2 - t-1
        diff_1 = cv2.absdiff(frames[1], frames[2])   # t-1 - t

        # Accumulated absolute difference (t-2 to t)
        diff_acc = cv2.absdiff(frames[0], frames[2])

        # Normalise each to 0–255 using percentile stretching
        channels: List[np.ndarray] = []
        for diff in [diff_0, diff_1, diff_acc]:
            normed = self._normalise_to_uint8(diff)
            channels.append(normed)

        # Stack into 3-channel image
        stack = np.stack(channels, axis=-1)
        return stack

    def _detect_motion_streak(self, motion_stack: np.ndarray) -> Optional[dict]:
        """Detect motion streaks in the spatio-temporal stack.

        Uses contour analysis on the motion stack to find elongated regions
        (high aspect ratio contours = motion streaks).

        Returns:
            Dict with ``'x'``, ``'y'``, ``'speed'``, ``'confidence'``
            or ``None``.
        """
        # Combine channels with emphasis on recent motion
        combined = cv2.addWeighted(
            motion_stack[:, :, 0], 0.3,
            motion_stack[:, :, 1], 0.5,
            0,
        )
        combined = cv2.addWeighted(
            combined, 0.7,
            motion_stack[:, :, 2], 0.3,
            0,
        )

        # Threshold to binary
        _, binary = cv2.threshold(combined, 25, 255, cv2.THRESH_BINARY)

        # Morphological cleanup — remove noise, connect nearby streaks
        kernel_dilate = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        binary = cv2.dilate(binary, kernel_dilate, iterations=1)
        kernel_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 3))
        binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel_open)

        contours, _ = cv2.findContours(
            binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE,
        )

        if not contours:
            return None

        best_streak: Optional[dict] = None
        best_score = 0.0

        for contour in contours:
            area = cv2.contourArea(contour)
            if area < 30 or area > 3000:
                continue

            rect = cv2.boundingRect(contour)
            rx, ry, rw, rh = rect

            # Aspect ratio: elongated contours indicate motion streaks
            aspect = max(rw, rh) / max(min(rw, rh), 1)

            # Perimeter-to-area ratio (more elongated = higher)
            peri = cv2.arcLength(contour, True)
            if peri == 0:
                continue
            circularity = 4.0 * np.pi * area / (peri * peri)

            # A good streak has: high aspect ratio (> 2.5), low circularity
            # (< 0.5), and reasonable area
            if aspect < 2.0:
                continue
            if circularity > 0.6:
                continue

            # Score based on aspect ratio and size
            streak_score = aspect * min(area / 100.0, 1.0) * (1.0 - circularity)

            if streak_score > best_score:
                best_score = streak_score
                # Centre of the contour
                M = cv2.moments(contour)
                if M["m00"] > 0:
                    cx = M["m10"] / M["m00"]
                    cy = M["m01"] / M["m00"]
                else:
                    cx = rx + rw / 2.0
                    cy = ry + rh / 2.0

                # Estimate speed from streak length and temporal extent
                streak_length = float(max(rw, rh))
                # Speed proportional to how long the streak is
                estimated_speed = streak_length * 15.0  # heuristic px/s

                best_streak = {
                    "x": cx,
                    "y": cy,
                    "speed": estimated_speed,
                    "confidence": min(aspect / 8.0, 1.0),
                }

        return best_streak

    # ------------------------------------------------------------------
    # Velocity threshold computation
    # ------------------------------------------------------------------

    def _compute_velocity_threshold(self, hand_speed: float) -> float:
        """Compute velocity-dependent distance threshold.

        When the hand is moving fast (bowling action), the release happens
        at a closer distance.  When moving slow (before action), the
        threshold is larger.

        Linear interpolation between *velocity_threshold_high* (fast hand)
        and *velocity_threshold_low* (slow hand) based on *hand_speed*.

        Args:
            hand_speed: Hand speed in pixels/second.

        Returns:
            Distance threshold in pixels.
        """
        # Normalise hand speed to [0, 1] range using 500 px/s as "fast"
        max_speed = 500.0
        t = min(hand_speed / max_speed, 1.0)

        # Interpolate: fast hand → low threshold, slow hand → high threshold
        threshold = self.velocity_threshold_low + t * (
            self.velocity_threshold_high - self.velocity_threshold_low
        )

        return float(threshold)

    # ------------------------------------------------------------------
    # Tier 3: Multi-signal fallback
    # ------------------------------------------------------------------

    def _fallback_multi_signal(
        self,
        detections: List[Dict[str, Any]],
        frame_height: int,
    ) -> Optional[int]:
        """Fallback to the existing multi-signal approach from VideoProcessor.

        This is the existing ``_detect_release_frame`` logic from
        ``video_processor.py`` (multi-signal with size consistency, velocity
        direction, speed threshold, y-acceleration, consecutive validation).

        Args:
            detections: Raw detection dicts.
            frame_height: Frame height in pixels.

        Returns:
            Index into *detections* or ``None``.
        """
        try:
            from app.services.video_processor import VideoProcessor
            return VideoProcessor._detect_release_frame(
                detections, frame_height,
            )
        except Exception as exc:
            logger.warning(
                "Multi-signal fallback failed: %s", exc,
            )
            return None

    # ------------------------------------------------------------------
    # Utility methods
    # ------------------------------------------------------------------

    @staticmethod
    def _normalise_to_uint8(image: np.ndarray) -> np.ndarray:
        """Normalise a grayscale image to 0–255 ``uint8`` using percentile
        stretching for robust contrast enhancement.

        Uses 2nd and 98th percentiles to avoid outlier influence.

        Args:
            image: Grayscale ``np.uint8`` or ``float`` image.

        Returns:
            ``np.uint8`` image with values in [0, 255].
        """
        p_low = float(np.percentile(image, 2))
        p_high = float(np.percentile(image, 98))

        if p_high - p_low < 1.0:
            # Nearly uniform image — return zeros
            return np.zeros_like(image, dtype=np.uint8)

        # Clip and scale to 0–255
        clipped = np.clip(image, p_low, p_high)
        normalised = ((clipped - p_low) / (p_high - p_low) * 255.0)
        return normalised.astype(np.uint8)

    @staticmethod
    def _find_closest_detection_index(
        detections: List[Dict[str, Any]],
        target_frame: int,
    ) -> Optional[int]:
        """Find the detection index whose ``frame_number`` is closest to
        *target_frame*.

        Args:
            detections: List of detection dicts with a ``frame_number`` key.
            target_frame: Desired frame number.

        Returns:
            Index into *detections* or ``None``.
        """
        if not detections:
            return None

        best_idx = 0
        best_diff = float("inf")
        for i, d in enumerate(detections):
            fn = d.get("frame_number", 0)
            diff = abs(fn - target_frame)
            if diff < best_diff:
                best_diff = diff
                best_idx = i

        return best_idx
