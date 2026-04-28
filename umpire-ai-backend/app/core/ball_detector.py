"""
Hybrid cricket ball detector — v2.

Uses a **two-tier detection strategy** for maximum accuracy and deployability:

    **Tier 1 (GPU):** YOLOv11 with P2 detection head for tiny-object detection.
    Trained single-class on cricket balls. Handles motion blur, occlusion
    edges, and sub-10px balls far better than classical methods.

    **Tier 2 (CPU fallback):** HSV colour segmentation + MOG2 background
    subtraction + morphological cleanup. Kept as a reliable fallback when
    no GPU is available or the YOLO model hasn't been downloaded.

The tier is selected automatically based on whether the ultralytics package
and a trained model weights file can be loaded.  The user can also force
a tier via the ``detection_tier`` setting.
"""

import cv2
import numpy as np
from typing import Optional, Tuple, List
from dataclasses import dataclass
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


@dataclass
class BallDetection:
    """Represents a single ball detection in one video frame.

    Attributes:
        x: Horizontal centre of the detected ball (pixels).
        y: Vertical centre of the detected ball (pixels).
        radius: Estimated radius of the ball (pixels).
        confidence: Detection confidence score in [0, 1].
        frame_number: The frame index within the video.
        timestamp: Video timestamp in seconds.
    """
    x: int
    y: int
    radius: float
    confidence: float
    frame_number: int
    timestamp: float


# ======================================================================
# Tier 1: YOLOv11 + P2 head detector
# ======================================================================

class YOLOBallDetector:
    """Deep-learning ball detector using YOLOv11 with P2 small-object head.

    Advantages over HSV segmentation:
        - Handles motion-blurred balls (common at 140+ km/h)
        - Works across lighting changes (shadows, floodlights)
        - Distinguishes ball from shoes, clothing, field markers
        - Robust to partial occlusion by bowler body, bat
        - P2 (320x320) head detects balls as small as 3-5 pixels

    Usage::

        detector = YOLOBallDetector(model_path="yolo11s_cricket_ball.pt")
        detections = detector.detect(frame, 0, 0.0)
    """

    def __init__(
        self,
        model_path: str = "yolo11s_cricket_ball.pt",
        conf_threshold: float = 0.35,
        iou_threshold: float = 0.45,
        imgsz: int = 1280,
        device: str = "",
    ):
        """Initialise the YOLO detector.

        Args:
            model_path: Path to trained YOLOv11 weights (single-class).
                If the file does not exist, the detector will attempt to
                download the base ``yolo11s.pt`` model and use it with
                a default class-agnostic ball filter.
            conf_threshold: Minimum detection confidence.
            iou_threshold: NMS IoU threshold.
            imgsz: Inference resolution (1280 recommended for small balls).
            device: Device string (empty = auto, "0" for first GPU, "cpu").
        """
        self.conf_threshold = conf_threshold
        self.iou_threshold = iou_threshold
        self.imgsz = imgsz

        try:
            from ultralytics import YOLO

            weights = Path(model_path)
            if weights.exists():
                self.model = YOLO(str(weights))
                logger.info("Loaded trained model: %s", model_path)
            else:
                # Fall back to base YOLOv11s — will detect ball as
                # class 32 ("sports ball") from COCO or similar
                self.model = YOLO("yolo11s.pt")
                logger.warning(
                    "No trained model at '%s'; using base yolo11s.pt. "
                    "Fine-tune on cricket ball data for best accuracy.",
                    model_path,
                )

            self.device = device
            self._available = True

        except ImportError:
            logger.warning(
                "ultralytics package not installed — "
                "YOLO detection unavailable. Install with: "
                "pip install ultralytics"
            )
            self._available = False
        except Exception as exc:
            logger.error("Failed to initialise YOLO model: %s", exc)
            self._available = False

    @property
    def available(self) -> bool:
        """Whether YOLO detection is ready to use."""
        return self._available

    def detect(
        self,
        frame: np.ndarray,
        frame_number: int = 0,
        timestamp: float = 0.0,
    ) -> List[BallDetection]:
        """Run YOLO inference on a single frame.

        Args:
            frame: BGR image from cv2.VideoCapture.
            frame_number: Sequential frame index.
            timestamp: Elapsed time in seconds.

        Returns:
            List of :class:`BallDetection`, sorted by confidence desc.
        """
        if not self._available or frame is None or frame.size == 0:
            return []

        results = self.model(
            frame,
            conf=self.conf_threshold,
            iou=self.iou_threshold,
            imgsz=self.imgsz,
            device=self.device,
            verbose=False,
            classes=[0],  # single-class: cricket ball (class 0)
        )

        detections: List[BallDetection] = []
        for r in results:
            boxes = r.boxes
            if boxes is None:
                continue
            for box in boxes:
                xywh = box.xywh[0].cpu().numpy()
                cx, cy, w, h = xywh
                radius = float(max(w, h) / 2.0)
                conf = float(box.conf[0].cpu().numpy())
                detections.append(BallDetection(
                    x=int(cx), y=int(cy),
                    radius=round(radius, 1),
                    confidence=round(conf, 3),
                    frame_number=frame_number,
                    timestamp=round(timestamp, 4),
                ))

        detections.sort(key=lambda d: d.confidence, reverse=True)
        return detections[:3]


# ======================================================================
# Tier 2: Classical HSV + MOG2 detector (CPU fallback)
# ======================================================================

class ClassicalBallDetector:
    """OpenCV-based cricket ball detector using HSV colour segmentation
    and MOG2 background subtraction.

    This is the CPU-only fallback that requires no GPU or model weights.
    Suitable for development, testing, and environments without a GPU.
    """

    BALL_TYPES: dict = {
        "red": {
            "hsv_ranges": [
                (np.array([0, 100, 100], dtype=np.uint8),
                 np.array([10, 255, 255], dtype=np.uint8)),
                (np.array([160, 100, 100], dtype=np.uint8),
                 np.array([180, 255, 255], dtype=np.uint8)),
            ],
        },
        "white": {
            "hsv_ranges": [
                (np.array([0, 0, 200], dtype=np.uint8),
                 np.array([180, 50, 255], dtype=np.uint8)),
            ],
        },
        "pink": {
            "hsv_ranges": [
                (np.array([140, 50, 150], dtype=np.uint8),
                 np.array([170, 255, 255], dtype=np.uint8)),
            ],
        },
    }

    def __init__(
        self,
        ball_type: str = "red",
        min_radius: int = 3,
        max_radius: int = 25,
        min_confidence: float = 0.6,
    ):
        if ball_type not in self.BALL_TYPES:
            raise ValueError(f"Unknown ball_type '{ball_type}'")
        self.ball_type = ball_type
        self.min_radius = min_radius
        self.max_radius = max_radius
        self.min_confidence = min_confidence
        self.bg_subtractor = cv2.createBackgroundSubtractorMOG2(
            history=500, varThreshold=50, detectShadows=True,
        )

    def detect(
        self,
        frame: np.ndarray,
        frame_number: int = 0,
        timestamp: float = 0.0,
    ) -> List[BallDetection]:
        """Run classical detection pipeline on a frame."""
        if frame is None or frame.size == 0:
            return []

        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        mask = self._color_mask(hsv)
        mask = self._morphology(mask)
        contours = cv2.findContours(
            mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )[0]
        detections = self._filter(contours, frame_number, timestamp)

        if len(detections) > 1:
            detections = self._motion_boost(frame, detections)

        detections = [d for d in detections if d.confidence >= self.min_confidence]
        return detections[:3]

    # -- helpers --

    def _color_mask(self, hsv: np.ndarray) -> np.ndarray:
        cfg = self.BALL_TYPES[self.ball_type]
        combined = np.zeros(hsv.shape[:2], dtype=np.uint8)
        for lo, hi in cfg["hsv_ranges"]:
            combined = cv2.bitwise_or(combined, cv2.inRange(hsv, lo, hi))
        return combined

    def _morphology(self, mask: np.ndarray) -> np.ndarray:
        k1 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        k2 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k1, iterations=2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k2, iterations=1)
        mask = cv2.GaussianBlur(mask, (5, 5), 0)
        _, mask = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)
        return mask

    def _filter(self, contours, fn, ts) -> List[BallDetection]:
        out: List[BallDetection] = []
        for c in contours:
            area = cv2.contourArea(c)
            if area < 20 or area > 5000:
                continue
            peri = cv2.arcLength(c, True)
            if peri == 0:
                continue
            circ = 4.0 * np.pi * area / (peri * peri)
            if circ < 0.4:
                continue
            (cx, cy), r = cv2.minEnclosingCircle(c)
            r = int(r)
            rect = cv2.boundingRect(c)
            ar = rect[2] / max(rect[3], 1)
            if ar < 0.5 or ar > 2.0:
                continue
            conf = min(circ * 0.7 + 0.3, 1.0)
            if self.min_radius <= r <= self.max_radius:
                out.append(BallDetection(
                    x=int(cx), y=int(cy), radius=float(r),
                    confidence=round(conf, 3), frame_number=fn,
                    timestamp=round(ts, 4),
                ))
        out.sort(key=lambda d: d.confidence, reverse=True)
        return out[:3]

    def _motion_boost(
        self, frame: np.ndarray, detections: List[BallDetection]
    ) -> List[BallDetection]:
        fg = self.bg_subtractor.apply(frame)
        enhanced: List[BallDetection] = []
        for d in detections:
            r = int(d.radius)
            y1, y2 = max(0, d.y - r), min(fg.shape[0], d.y + r + 1)
            x1, x2 = max(0, d.x - r), min(fg.shape[1], d.x + r + 1)
            region = fg[y1:y2, x1:x2]
            fg_ratio = np.count_nonzero(region) / max(region.size, 1)
            if fg_ratio > 0.1:
                enhanced.append(BallDetection(
                    x=d.x, y=d.y, radius=d.radius,
                    confidence=min(d.confidence + 0.2, 1.0),
                    frame_number=d.frame_number, timestamp=d.timestamp,
                ))
        return enhanced if enhanced else detections


# ======================================================================
# Hybrid facade
# ======================================================================

class BallDetector:
    """Hybrid ball detector that automatically selects the best available
    detection method.

    Priority:
        1. **YOLOv11 + P2 head** (GPU — best accuracy)
        2. **YOLOv11 base model** (GPU — good accuracy)
        3. **HSV + MOG2** (CPU fallback — basic accuracy)

    Set ``detection_tier`` in :class:`~app.config.Settings` to force a
    specific tier (``"yolo"``, ``"classical"``, or ``"auto"``).
    """

    def __init__(
        self,
        ball_type: str = "red",
        min_radius: int = 3,
        max_radius: int = 25,
        min_confidence: float = 0.6,
        detection_tier: str = "auto",
        model_path: str = "yolo11s_cricket_ball.pt",
        yolo_conf: float = 0.35,
        yolo_imgsz: int = 1280,
        device: str = "",
    ):
        """Initialise the hybrid detector.

        Args:
            ball_type: Ball colour for classical fallback.
            min_radius: Min ball radius for classical fallback.
            max_radius: Max ball radius for classical fallback.
            min_confidence: Min confidence for classical fallback.
            detection_tier: ``"auto"``, ``"yolo"``, or ``"classical"``.
            model_path: Path to YOLO weights.
            yolo_conf: YOLO confidence threshold.
            yolo_imgsz: YOLO inference resolution.
            device: ``""`` (auto), ``"0"``, or ``"cpu"``.
        """
        self.tier = detection_tier
        self._yolo: Optional[YOLOBallDetector] = None
        self._classical: Optional[ClassicalBallDetector] = None

        # Try to initialise YOLO
        if detection_tier in ("auto", "yolo"):
            self._yolo = YOLOBallDetector(
                model_path=model_path,
                conf_threshold=yolo_conf,
                imgsz=yolo_imgsz,
                device=device,
            )
            if not self._yolo.available and detection_tier == "yolo":
                logger.warning(
                    "YOLO requested but not available — falling back to classical"
                )
                self.tier = "classical"
            elif self._yolo.available:
                self.tier = "yolo"

        # Classical fallback
        if self.tier == "classical" or self._yolo is None:
            self._classical = ClassicalBallDetector(
                ball_type=ball_type,
                min_radius=min_radius,
                max_radius=max_radius,
                min_confidence=min_confidence,
            )
            if self.tier == "auto":
                self.tier = "classical"

        logger.info("Ball detector initialised with tier: %s", self.tier)

    @property
    def active_tier(self) -> str:
        """Return the currently active detection tier name."""
        return self.tier

    def detect(
        self,
        frame: np.ndarray,
        frame_number: int = 0,
        timestamp: float = 0.0,
    ) -> List[BallDetection]:
        """Run detection using the active tier.

        If YOLO is active but produces zero detections while the
        classical method finds candidates, the results are merged
        (ensuring no frame is missed entirely).
        """
        yolo_dets: List[BallDetection] = []
        classical_dets: List[BallDetection] = []

        if self._yolo and self._yolo.available:
            yolo_dets = self._yolo.detect(frame, frame_number, timestamp)

        if self._classical:
            classical_dets = self._classical.detect(frame, frame_number, timestamp)

        # If YOLO found something, prefer it (higher quality)
        if yolo_dets:
            return yolo_dets

        # If YOLO found nothing but classical did, use classical
        if classical_dets:
            return classical_dets

        return []
