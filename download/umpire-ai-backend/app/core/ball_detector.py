"""
OpenCV-based cricket ball detector.

Uses HSV color-space segmentation combined with morphological operations
and background subtraction (MOG2) to detect cricket balls in video frames.

Supports red, white, and pink ball types with tunable parameters.
"""

import cv2
import numpy as np
from typing import Optional, Tuple, List
from dataclasses import dataclass


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


class BallDetector:
    """Detects cricket balls in individual video frames using colour-based
    segmentation augmented with morphological cleanup and motion context.

    The detection pipeline per frame is:
        1. BGR → HSV conversion
        2. Colour-range masking (ball-type specific)
        3. Morphological open / close / blur for noise removal
        4. Contour extraction
        5. Contour filtering by circularity, area, and aspect ratio
        6. Optional: motion-context boost via background subtraction (MOG2)
    """

    BALL_TYPES: dict = {
        "red": {
            "hsv_ranges": [
                (np.array([0, 100, 100], dtype=np.uint8),
                 np.array([10, 255, 255], dtype=np.uint8)),
                (np.array([160, 100, 100], dtype=np.uint8),
                 np.array([180, 255, 255], dtype=np.uint8)),
            ],
            "label": "Red Ball",
        },
        "white": {
            "hsv_ranges": [
                (np.array([0, 0, 200], dtype=np.uint8),
                 np.array([180, 50, 255], dtype=np.uint8)),
            ],
            "label": "White Ball",
        },
        "pink": {
            "hsv_ranges": [
                (np.array([140, 50, 150], dtype=np.uint8),
                 np.array([170, 255, 255], dtype=np.uint8)),
            ],
            "label": "Pink Ball",
        },
    }

    def __init__(
        self,
        ball_type: str = "red",
        min_radius: int = 3,
        max_radius: int = 25,
        min_confidence: float = 0.6,
    ):
        """Initialise the detector.

        Args:
            ball_type: One of ``"red"``, ``"white"``, ``"pink"``.
            min_radius: Minimum acceptable ball radius in pixels.
            max_radius: Maximum acceptable ball radius in pixels.
            min_confidence: Discard detections below this threshold.
        """
        if ball_type not in self.BALL_TYPES:
            raise ValueError(
                f"Unknown ball_type '{ball_type}'. "
                f"Choose from {list(self.BALL_TYPES.keys())}"
            )

        self.ball_type = ball_type
        self.min_radius = min_radius
        self.max_radius = max_radius
        self.min_confidence = min_confidence
        self._setup_background_subtractor()

    # ------------------------------------------------------------------
    # Background subtractor (MOG2)
    # ------------------------------------------------------------------

    def _setup_background_subtractor(self) -> None:
        """Create the MOG2 background subtractor used for motion-context
        filtering.  Shadows are detected so they do not pollute the
        foreground mask."""
        self.bg_subtractor = cv2.createBackgroundSubtractorMOG2(
            history=500,
            varThreshold=50,
            detectShadows=True,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def detect(
        self,
        frame: np.ndarray,
        frame_number: int = 0,
        timestamp: float = 0.0,
    ) -> List[BallDetection]:
        """Run the full detection pipeline on *frame*.

        Args:
            frame: BGR image (numpy array) from ``cv2.VideoCapture``.
            frame_number: Sequential index of the frame in the video.
            timestamp: Elapsed time in seconds corresponding to the frame.

        Returns:
            List of :class:`BallDetection` candidates, sorted by descending
            confidence.  At most 3 candidates are returned.
        """
        if frame is None or frame.size == 0:
            return []

        # 1. Convert colour space
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

        # 2. Colour-based mask
        mask = self._create_color_mask(hsv)

        # 3. Morphological cleanup
        mask = self._morphological_cleanup(mask)

        # 4. Find contours
        contours: list = cv2.findContours(
            mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
        )[0]

        # 5. Filter by circularity, area, aspect ratio
        detections = self._filter_detections(contours, frame_number, timestamp)

        # 6. Apply motion context when multiple candidates remain
        if len(detections) > 1:
            detections = self._apply_motion_context(frame, detections)

        # 7. Confidence threshold
        detections = [d for d in detections if d.confidence >= self.min_confidence]

        return detections[:3]

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _create_color_mask(self, hsv: np.ndarray) -> np.ndarray:
        """Build a binary mask by OR-ing HSV in-range checks for the
        configured ball type."""
        ball_config = self.BALL_TYPES[self.ball_type]
        combined_mask = np.zeros(hsv.shape[:2], dtype=np.uint8)

        for lower, upper in ball_config["hsv_ranges"]:
            range_mask = cv2.inRange(hsv, lower, upper)
            combined_mask = cv2.bitwise_or(combined_mask, range_mask)

        return combined_mask

    def _morphological_cleanup(self, mask: np.ndarray) -> np.ndarray:
        """Apply open → close → Gaussian blur → threshold to remove noise
        and produce a clean binary mask."""
        kernel_small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        kernel_large = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))

        # Remove small speckles
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel_small, iterations=2)
        # Close small internal holes
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel_large, iterations=1)
        # Smooth edges
        mask = cv2.GaussianBlur(mask, (5, 5), 0)
        # Re-binarise
        _, mask = cv2.threshold(mask, 127, 255, cv2.THRESH_BINARY)

        return mask

    def _filter_detections(
        self,
        contours: list,
        frame_number: int,
        timestamp: float,
    ) -> List[BallDetection]:
        """Filter contours by area, circularity, aspect ratio, and radius.

        Returns up to 3 candidates sorted by confidence (descending).
        """
        detections: List[BallDetection] = []

        for contour in contours:
            area = cv2.contourArea(contour)
            if area < 20 or area > 5000:
                continue

            perimeter = cv2.arcLength(contour, True)
            if perimeter == 0:
                continue

            circularity = 4.0 * np.pi * area / (perimeter * perimeter)
            if circularity < 0.4:
                continue

            # Minimum enclosing circle
            (cx, cy), radius = cv2.minEnclosingCircle(contour)
            radius = int(radius)

            # Aspect ratio of the bounding rectangle
            rect = cv2.boundingRect(contour)
            aspect_ratio = rect[2] / max(rect[3], 1)
            if aspect_ratio < 0.5 or aspect_ratio > 2.0:
                continue

            # Confidence: blend circularity with a base score
            confidence = min(circularity * 0.7 + 0.3, 1.0)

            if self.min_radius <= radius <= self.max_radius:
                detections.append(BallDetection(
                    x=int(cx),
                    y=int(cy),
                    radius=float(radius),
                    confidence=round(confidence, 3),
                    frame_number=frame_number,
                    timestamp=round(timestamp, 4),
                ))

        detections.sort(key=lambda d: d.confidence, reverse=True)
        return detections[:3]

    def _apply_motion_context(
        self,
        frame: np.ndarray,
        detections: List[BallDetection],
    ) -> List[BallDetection]:
        """Use MOG2 background subtraction to boost confidence for
        detections that overlap with foreground (moving) pixels."""
        fg_mask = self.bg_subtractor.apply(frame)

        enhanced: List[BallDetection] = []
        for det in detections:
            r = int(det.radius)
            y1 = max(0, det.y - r)
            y2 = min(fg_mask.shape[0], det.y + r + 1)
            x1 = max(0, det.x - r)
            x2 = min(fg_mask.shape[1], det.x + r + 1)

            region = fg_mask[y1:y2, x1:x2]
            fg_ratio = np.count_nonzero(region) / max(region.size, 1)

            if fg_ratio > 0.1:
                boosted = BallDetection(
                    x=det.x,
                    y=det.y,
                    radius=det.radius,
                    confidence=min(det.confidence + 0.2, 1.0),
                    frame_number=det.frame_number,
                    timestamp=det.timestamp,
                )
                enhanced.append(boosted)

        return enhanced if enhanced else detections
