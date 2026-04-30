"""
Bowler pose estimation for cricket ball release detection.

Provides a **two-tier pose estimation strategy** to extract the bowler's
hand position during the delivery stride, enabling precise release-point
identification:

    **Tier 1 — MediaPipe Pose (CPU, most accurate):**
    Google's 33-keypoint body-pose model. Produces high-fidelity wrist
    and elbow landmarks even at moderate video resolutions. Runs entirely
    on CPU and requires no GPU.

    **Tier 2 — YOLO-Pose (GPU accelerated):**
    Ultralytics YOLOv8-Pose / YOLO11-Pose with COCO 17-keypoint format.
    GPU-accelerated and well-suited for batched inference on long video
    sequences. Falls back gracefully when ultralytics is unavailable.

The ``PoseEstimator`` facade automatically selects the best available
backend based on installed packages and the ``pose_tier`` setting, mirroring
the pattern used by :class:`~app.core.ball_detector.BallDetector`.
"""

import numpy as np
from typing import Optional, Tuple, List, Dict
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)


# ======================================================================
# Data classes
# ======================================================================

@dataclass
class PoseKeypoint:
    """A single body-pose keypoint detected in a video frame.

    Attributes:
        x: Horizontal position in pixels.
        y: Vertical position in pixels.
        confidence: Detection confidence in [0, 1].
        name: Semantic label (e.g. ``"LEFT_WRIST"``, ``"RIGHT_ELBOW"``).
    """
    x: float
    y: float
    confidence: float
    name: str


@dataclass
class PoseResult:
    """Aggregated pose estimation result for a single frame.

    Attributes:
        keypoints: Mapping of keypoint name to :class:`PoseKeypoint`.
        hand_position: Bowling-hand centre ``(x, y)`` in pixels, or
            ``None`` if the wrist was not detected.
        hand_confidence: Confidence score for the bowling-hand keypoint.
        frame_number: Sequential frame index within the video.
        timestamp: Elapsed video time in seconds.
    """
    keypoints: Dict[str, PoseKeypoint]
    hand_position: Optional[Tuple[float, float]]
    hand_confidence: float
    frame_number: int
    timestamp: float


# ======================================================================
# MediaPipe landmark name mapping (33 keypoints)
# ======================================================================

_MEDIAPIPE_LANDMARK_NAMES = [
    "NOSE", "LEFT_EYE_INNER", "LEFT_EYE", "LEFT_EYE_OUTER",
    "RIGHT_EYE_INNER", "RIGHT_EYE", "RIGHT_EYE_OUTER",
    "LEFT_EAR", "RIGHT_EAR", "MOUTH_LEFT", "MOUTH_RIGHT",
    "LEFT_SHOULDER", "RIGHT_SHOULDER", "LEFT_ELBOW", "RIGHT_ELBOW",
    "LEFT_WRIST", "RIGHT_WRIST", "LEFT_PINKY", "RIGHT_PINKY",
    "LEFT_INDEX", "RIGHT_INDEX", "LEFT_THUMB", "RIGHT_THUMB",
    "LEFT_HIP", "RIGHT_HIP", "LEFT_KNEE", "RIGHT_KNEE",
    "LEFT_ANKLE", "RIGHT_ANKLE", "LEFT_HEEL", "RIGHT_HEEL",
    "LEFT_FOOT_INDEX", "RIGHT_FOOT_INDEX",
]

# COCO 17-keypoint names used by YOLO-Pose
_YOLO_KEYPOINT_NAMES = [
    "NOSE", "LEFT_EYE", "RIGHT_EYE", "LEFT_EAR", "RIGHT_EAR",
    "LEFT_SHOULDER", "RIGHT_SHOULDER", "LEFT_ELBOW", "RIGHT_ELBOW",
    "LEFT_WRIST", "RIGHT_WRIST", "LEFT_HIP", "RIGHT_HIP",
    "LEFT_KNEE", "RIGHT_KNEE", "LEFT_ANKLE", "RIGHT_ANKLE",
]


# ======================================================================
# Tier 1: MediaPipe Pose
# ======================================================================

class MediaPipePoseEstimator:
    """Pose estimator using Google's MediaPipe Pose solution.

    Extracts all 33 body landmarks and specifically identifies the
    bowling hand wrist position (right wrist by default for right-handed
    bowlers). The ``STATIC_IMAGE_MODE`` is set to ``False`` so that the
    internal tracker improves temporal consistency across video frames.

    Usage::

        estimator = MediaPipePoseEstimator()
        result = estimator.estimate(frame, frame_number=0, timestamp=0.0)
        if result and result.hand_position:
            print(f"Wrist at {result.hand_position}")
    """

    def __init__(
        self,
        static_image_mode: bool = False,
        model_complexity: int = 1,
        smooth_landmarks: bool = True,
        min_detection_confidence: float = 0.5,
        min_tracking_confidence: float = 0.5,
        bowling_hand: str = "right",
    ):
        """Initialise the MediaPipe pose estimator.

        Args:
            static_image_mode: If ``False``, uses video-optimised tracking.
            model_complexity: ``0`` (lite), ``1`` (full), ``2`` (heavy).
            smooth_landmarks: Apply temporal smoothing.
            min_detection_confidence: Min confidence for initial detection.
            min_tracking_confidence: Min confidence for inter-frame tracking.
            bowling_hand: ``"right"`` or ``"left"`` — which wrist is the
                bowling hand.
        """
        self._available = False
        self._pose = None
        self._bowling_hand = bowling_hand.upper()

        try:
            import mediapipe as mp

            self._mp_pose = mp.solutions.pose
            self._mp_drawing = mp.solutions.drawing_utils
            self._pose = self._mp_pose.Pose(
                static_image_mode=static_image_mode,
                model_complexity=model_complexity,
                smooth_landmarks=smooth_landmarks,
                min_detection_confidence=min_detection_confidence,
                min_tracking_confidence=min_tracking_confidence,
            )
            self._available = True
            logger.info("MediaPipe Pose estimator initialised (hand=%s)", bowling_hand)
        except ImportError:
            logger.warning(
                "mediapipe package not installed — "
                "MediaPipe pose estimation unavailable. Install with: "
                "pip install mediapipe"
            )
        except Exception as exc:
            logger.error("Failed to initialise MediaPipe Pose: %s", exc)

    @property
    def available(self) -> bool:
        """Whether MediaPipe pose estimation is ready to use."""
        return self._available

    def estimate(
        self,
        frame: np.ndarray,
        frame_number: int = 0,
        timestamp: float = 0.0,
    ) -> Optional[PoseResult]:
        """Run pose estimation on a single BGR frame.

        Args:
            frame: BGR image from ``cv2.VideoCapture``.
            frame_number: Sequential frame index.
            timestamp: Elapsed time in seconds.

        Returns:
            :class:`PoseResult` if at least the bowling wrist was found,
            otherwise ``None``.
        """
        if not self._available or frame is None or frame.size == 0:
            return None

        rgb = frame[:, :, ::-1]  # BGR -> RGB
        h, w = frame.shape[:2]
        results = self._pose.process(rgb)

        if results.pose_landmarks is None:
            return None

        landmarks = results.pose_landmarks.landmark
        keypoints: Dict[str, PoseKeypoint] = {}

        for idx, name in enumerate(_MEDIAPIPE_LANDMARK_NAMES):
            lm = landmarks[idx]
            keypoints[name] = PoseKeypoint(
                x=float(lm.x * w),
                y=float(lm.y * h),
                confidence=float(lm.visibility),
                name=name,
            )

        # Identify bowling hand wrist
        wrist_name = f"{self._bowling_hand}_WRIST"
        wrist_kp = keypoints.get(wrist_name)
        hand_position: Optional[Tuple[float, float]] = None
        hand_confidence = 0.0

        if wrist_kp and wrist_kp.confidence > 0.3:
            hand_position = (wrist_kp.x, wrist_kp.y)
            hand_confidence = wrist_kp.confidence

        if hand_position is None:
            return None

        return PoseResult(
            keypoints=keypoints,
            hand_position=hand_position,
            hand_confidence=round(hand_confidence, 3),
            frame_number=frame_number,
            timestamp=round(timestamp, 4),
        )

    def close(self) -> None:
        """Release MediaPipe resources."""
        if self._pose is not None:
            self._pose.close()
            self._pose = None
            self._available = False


# ======================================================================
# Tier 2: YOLO-Pose (GPU accelerated)
# ======================================================================

class YOLOPoseEstimator:
    """Pose estimator using an Ultralytics YOLOv8-Pose or YOLO11-Pose model.

    Outputs COCO 17-keypoint format. Keypoint indices:
        - 9 → ``RIGHT_WRIST``
        - 7 → ``LEFT_WRIST``

    The model runs on GPU by default and is significantly faster than
    MediaPipe for batch processing, though it requires model weights.

    Usage::

        estimator = YOLOPoseEstimator(model_path="yolo11n-pose.pt")
        result = estimator.estimate(frame, frame_number=0, timestamp=0.0)
    """

    # COCO keypoint indices for wrists
    _LEFT_WRIST_IDX = 9
    _RIGHT_WRIST_IDX = 10

    def __init__(
        self,
        model_path: str = "yolo11n-pose.pt",
        conf_threshold: float = 0.25,
        imgsz: int = 640,
        device: str = "",
        bowling_hand: str = "right",
    ):
        """Initialise the YOLO-Pose estimator.

        Args:
            model_path: Path to a YOLO pose model (e.g. ``yolo11n-pose.pt``).
                If the file does not exist, the estimator will be unavailable.
            conf_threshold: Minimum keypoint confidence threshold.
            imgsz: Inference resolution.
            device: ``""`` (auto), ``"0"``, or ``"cpu"``.
            bowling_hand: ``"right"`` or ``"left"``.
        """
        self._available = False
        self._model = None
        self._conf_threshold = conf_threshold
        self._imgsz = imgsz
        self._device = device
        self._bowling_hand = bowling_hand.upper()

        try:
            from pathlib import Path
            from ultralytics import YOLO

            weights = Path(model_path)
            if weights.exists():
                self._model = YOLO(str(weights))
                self._available = True
                logger.info(
                    "YOLO-Pose estimator loaded: %s (hand=%s)",
                    model_path, bowling_hand,
                )
            else:
                logger.warning(
                    "No YOLO-Pose model at '%s'; pose estimation unavailable.",
                    model_path,
                )
        except ImportError:
            logger.warning(
                "ultralytics package not installed — "
                "YOLO-Pose estimation unavailable. Install with: "
                "pip install ultralytics"
            )
        except Exception as exc:
            logger.error("Failed to initialise YOLO-Pose model: %s", exc)

    @property
    def available(self) -> bool:
        """Whether YOLO-Pose estimation is ready to use."""
        return self._available

    def estimate(
        self,
        frame: np.ndarray,
        frame_number: int = 0,
        timestamp: float = 0.0,
    ) -> Optional[PoseResult]:
        """Run YOLO-Pose inference on a single BGR frame.

        Args:
            frame: BGR image from ``cv2.VideoCapture``.
            frame_number: Sequential frame index.
            timestamp: Elapsed time in seconds.

        Returns:
            :class:`PoseResult` if a person was detected with a visible
            bowling-hand wrist, otherwise ``None``.
        """
        if not self._available or frame is None or frame.size == 0:
            return None

        results = self._model(
            frame,
            conf=self._conf_threshold,
            imgsz=self._imgsz,
            device=self._device,
            verbose=False,
        )

        if not results:
            return None

        # Take the first (most confident) person detection
        r = results[0]
        if r.keypoints is None or len(r.keypoints.data) == 0:
            return None

        kpts = r.keypoints.data[0].cpu().numpy()  # shape (17, 3) — x, y, conf
        h, w = frame.shape[:2]

        keypoints: Dict[str, PoseKeypoint] = {}
        for idx, name in enumerate(_YOLO_KEYPOINT_NAMES):
            if idx < len(kpts):
                kp = kpts[idx]
                keypoints[name] = PoseKeypoint(
                    x=float(kp[0]),
                    y=float(kp[1]),
                    confidence=float(kp[2]),
                    name=name,
                )

        # Select bowling hand wrist keypoint
        wrist_name = f"{self._bowling_hand}_WRIST"
        wrist_kp = keypoints.get(wrist_name)
        hand_position: Optional[Tuple[float, float]] = None
        hand_confidence = 0.0

        if wrist_kp and wrist_kp.confidence > 0.3:
            hand_position = (wrist_kp.x, wrist_kp.y)
            hand_confidence = wrist_kp.confidence

        if hand_position is None:
            return None

        return PoseResult(
            keypoints=keypoints,
            hand_position=hand_position,
            hand_confidence=round(hand_confidence, 3),
            frame_number=frame_number,
            timestamp=round(timestamp, 4),
        )


# ======================================================================
# Hybrid facade
# ======================================================================

class PoseEstimator:
    """Hybrid pose estimator that automatically selects the best available
    backend.

    Priority:
        1. **MediaPipe Pose** (CPU — highest keypoint accuracy)
        2. **YOLO-Pose** (GPU — fastest batch inference)
        3. ``None`` (no pose estimation available)

    Set ``pose_tier`` to ``"mediapipe"``, ``"yolopose"``, ``"none"``, or
    ``"auto"`` (default) to control backend selection.

    Usage::

        estimator = PoseEstimator(pose_tier="auto")
        result = estimator.estimate(frame, 0, 0.0)
    """

    def __init__(
        self,
        pose_tier: str = "auto",
        bowling_hand: str = "right",
        **kwargs,
    ):
        """Initialise the hybrid pose estimator.

        Args:
            pose_tier: ``"auto"``, ``"mediapipe"``, ``"yolopose"``, or ``"none"``.
            bowling_hand: ``"right"`` or ``"left"``.
            **kwargs: Extra keyword arguments forwarded to the selected
                backend constructor.
        """
        self._tier = pose_tier
        self._mediapipe: Optional[MediaPipePoseEstimator] = None
        self._yolopose: Optional[YOLOPoseEstimator] = None

        # --- MediaPipe ---
        if pose_tier in ("auto", "mediapipe"):
            self._mediapipe = MediaPipePoseEstimator(
                bowling_hand=bowling_hand,
                **kwargs,
            )
            if self._mediapipe.available:
                self._tier = "mediapipe"
            elif pose_tier == "mediapipe":
                logger.warning(
                    "MediaPipe requested but unavailable — falling back"
                )

        # --- YOLO-Pose ---
        if self._tier not in ("mediapipe", "none") and pose_tier in ("auto", "yolopose"):
            self._yolopose = YOLOPoseEstimator(
                bowling_hand=bowling_hand,
                **kwargs,
            )
            if self._yolopose.available:
                self._tier = "yolopose"
            elif pose_tier == "yolopose":
                logger.warning(
                    "YOLO-Pose requested but unavailable — no pose estimation"
                )

        if self._tier == "auto":
            self._tier = "none"

        logger.info("Pose estimator initialised with tier: %s", self._tier)

    @property
    def active_tier(self) -> str:
        """Return the currently active pose estimation tier name."""
        return self._tier

    def estimate(
        self,
        frame: np.ndarray,
        frame_number: int = 0,
        timestamp: float = 0.0,
    ) -> Optional[PoseResult]:
        """Run pose estimation using the active backend.

        Args:
            frame: BGR image from ``cv2.VideoCapture``.
            frame_number: Sequential frame index.
            timestamp: Elapsed time in seconds.

        Returns:
            :class:`PoseResult` if the bowling hand was detected, else
            ``None``.
        """
        if self._mediapipe and self._mediapipe.available:
            result = self._mediapipe.estimate(frame, frame_number, timestamp)
            if result is not None:
                return result

        if self._yolopose and self._yolopose.available:
            return self._yolopose.estimate(frame, frame_number, timestamp)

        return None

    def close(self) -> None:
        """Release resources held by any active backend."""
        if self._mediapipe is not None:
            self._mediapipe.close()


# ======================================================================
# Helper functions
# ======================================================================

def get_dynamic_roi(
    center_x: float,
    center_y: float,
    base_size: int = 120,
    velocity: float = 0.0,
) -> Tuple[int, int, int, int]:
    """Create a dynamic ROI around the bowler's hand.

    The region-of-interest scales with hand velocity so that fast arm
    movements during the delivery stride do not cause the ball to leave
    the search window.

    Args:
        center_x: Hand keypoint x-coordinate (pixels).
        center_y: Hand keypoint y-coordinate (pixels).
        base_size: Base ROI size in pixels.
        velocity: Hand velocity magnitude in pixels/second.

    Returns:
        ``(x1, y1, x2, y2)`` ROI bounds clamped to non-negative values.
    """
    expansion = int(min(velocity * 0.3, 80))
    size = base_size + expansion
    half = size // 2
    x1 = max(0, int(center_x) - half)
    y1 = max(0, int(center_y) - half)
    x2 = int(center_x) + half
    y2 = int(center_y) + half
    return (x1, y1, x2, y2)


def compute_hand_velocity(
    pose_history: List[PoseResult],
    window: int = 3,
) -> Tuple[float, float, float]:
    """Compute the bowling hand's velocity from recent pose results.

    Uses a simple sliding-window average over the most recent frames
    to smooth out jitter while remaining responsive to rapid acceleration
    during the delivery action.

    Args:
        pose_history: Recent :class:`PoseResult` objects (most recent last).
        window: Number of recent frames to average over.

    Returns:
        ``(vx, vy, speed)`` in pixels/second. Returns ``(0, 0, 0)`` if
        fewer than two results with valid hand positions are available.
    """
    if len(pose_history) < 2:
        return 0.0, 0.0, 0.0

    recent = pose_history[-window:]
    total_vx = 0.0
    total_vy = 0.0
    total_dt = 0.0

    for i in range(1, len(recent)):
        prev = recent[i - 1]
        curr = recent[i]

        if curr.hand_position is None or prev.hand_position is None:
            continue

        dt = max(curr.timestamp - prev.timestamp, 1e-6)
        dx = curr.hand_position[0] - prev.hand_position[0]
        dy = curr.hand_position[1] - prev.hand_position[1]

        total_vx += dx / dt
        total_vy += dy / dt
        total_dt += 1

    if total_dt > 0:
        vx = total_vx / total_dt
        vy = total_vy / total_dt
        speed = float(np.sqrt(vx * vx + vy * vy))
        return vx, vy, speed

    return 0.0, 0.0, 0.0
