"""
Perspective-transform pitch mapper.

Maps pixel coordinates from the video frame to real-world pitch
coordinates in metres using a four-point perspective transformation.
Supports manual calibration (user-supplied corner points) and
automatic pitch-line detection via Canny + Hough.
"""

import cv2
import numpy as np
from typing import Optional, Tuple, List
from dataclasses import dataclass


@dataclass
class PitchCalibration:
    """Four corner points of the pitch as visible in the video frame.

    The points define the visible pitch rectangle in this order:
    ``top_left → top_right → bottom_right → bottom_left``.
    """
    top_left: Tuple[int, int]
    top_right: Tuple[int, int]
    bottom_left: Tuple[int, int]
    bottom_right: Tuple[int, int]

    def get_source_points(self) -> np.ndarray:
        """Return source points as a float32 array for
        ``cv2.getPerspectiveTransform``."""
        return np.array([
            self.top_left, self.top_right,
            self.bottom_right, self.bottom_left,
        ], dtype=np.float32)

    def get_destination_points(
        self, width: int = 300, height: int = 1000
    ) -> np.ndarray:
        """Return destination (top-down) rectangle."""
        return np.array([
            [0, 0], [width, 0],
            [width, height], [0, height],
        ], dtype=np.float32)

    def to_dict(self) -> dict:
        """Serialise to a plain dictionary (for JSON export)."""
        return {
            "top_left": list(self.top_left),
            "top_right": list(self.top_right),
            "bottom_left": list(self.bottom_left),
            "bottom_right": list(self.bottom_right),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "PitchCalibration":
        """Deserialise from a dictionary."""
        return cls(
            top_left=tuple(data["top_left"]),
            top_right=tuple(data["top_right"]),
            bottom_left=tuple(data["bottom_left"]),
            bottom_right=tuple(data["bottom_right"]),
        )


class PitchMapper:
    """Converts between pixel coordinates and real-world pitch coordinates
    using a perspective transform.

    The destination (top-down) view maps to a virtual canvas of
    300 × 1000 pixels, which represents a real pitch of
    3.05 m × 20.12 m.

    Usage::

        mapper = PitchMapper(calibration)
        px_m, py_m = mapper.pixel_to_pitch(640, 360)
    """

    # Physical dimensions (centimetres)
    PITCH_LENGTH_CM: float = 2012.0  # 22 yards
    PITCH_WIDTH_CM: float = 305.0    # 10 feet
    CREASE_LENGTH_CM: float = 122.0  # 4 feet (popping crease)
    STUMP_HEIGHT_CM: float = 71.1    # 28 inches
    STUMP_WIDTH_CM: float = 22.86    # 9 inches total

    # Virtual canvas size (pixels)
    CANVAS_W: int = 300
    CANVAS_H: int = 1000

    def __init__(self, calibration: Optional[PitchCalibration] = None):
        self.calibration = calibration
        self.M: Optional[np.ndarray] = None
        self.M_inv: Optional[np.ndarray] = None
        if calibration:
            self._compute_transform()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def set_calibration(self, calibration: PitchCalibration) -> None:
        """(Re-)compute the perspective matrices from *calibration*."""
        self.calibration = calibration
        self._compute_transform()

    def pixel_to_pitch(self, x: float, y: float) -> Tuple[float, float]:
        """Map pixel ``(x, y)`` to real-world metres ``(x_m, y_m)``.

        The origin of the pitch coordinate system is the top-left corner
        of the bowling crease.  ``x_m`` spans the pitch width, and
        ``y_m`` spans the pitch length.

        Returns:
            ``(x_m, y_m)`` in metres.  Falls back to identity mapping
            when no calibration has been set.
        """
        if self.M is None:
            return x, y

        point = np.array([[[x, y]]], dtype=np.float32)
        transformed = cv2.perspectiveTransform(point, self.M)
        px, py = transformed[0][0]

        x_m = (px / self.CANVAS_W) * (self.PITCH_WIDTH_CM / 100.0)
        y_m = (py / self.CANVAS_H) * (self.PITCH_LENGTH_CM / 100.0)

        return round(float(x_m), 3), round(float(y_m), 3)

    def pitch_to_pixel(self, x_m: float, y_m: float) -> Tuple[float, float]:
        """Map real-world metres back to pixel coordinates.

        Returns:
            ``(pixel_x, pixel_y)``.  Falls back to identity mapping when
            no calibration has been set.
        """
        if self.M_inv is None:
            return x_m, y_m

        px = (x_m / (self.PITCH_WIDTH_CM / 100.0)) * self.CANVAS_W
        py = (y_m / (self.PITCH_LENGTH_CM / 100.0)) * self.CANVAS_H

        point = np.array([[[px, py]]], dtype=np.float32)
        transformed = cv2.perspectiveTransform(point, self.M_inv)
        result = transformed[0][0]
        return float(result[0]), float(result[1])

    def auto_detect_pitch(self, frame: np.ndarray) -> Optional[PitchCalibration]:
        """Attempt automatic pitch-line detection.

        Uses Canny edge detection followed by Hough line detection to
        find horizontal crease lines, then estimates the four pitch
        corners.

        Args:
            frame: BGR image (first frame of the video).

        Returns:
            A :class:`PitchCalibration` if detection succeeds, else
            ``None``.
        """
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        edges = cv2.Canny(gray, 50, 150)

        lines = cv2.HoughLinesP(
            edges, 1, np.pi / 180,
            threshold=100, minLineLength=50, maxLineGap=10,
        )
        if lines is None:
            return None

        # Keep nearly-horizontal lines (crease candidates)
        horizontal: List[Tuple[float, float, float, float, float]] = []
        for line in lines:
            x1, y1, x2, y2 = line[0]
            angle = abs(np.arctan2(y2 - y1, x2 - x1) * 180 / np.pi)
            if angle < 15 or angle > 165:
                length = float(np.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2))
                horizontal.append((float(x1), float(y1), float(x2), float(y2), length))

        if len(horizontal) < 2:
            return None

        # Sort by vertical centre; take top-most and bottom-most lines
        horizontal.sort(key=lambda l: (l[1] + l[3]) / 2)

        top = horizontal[0]
        bottom = horizontal[-1]

        margin = 20
        return PitchCalibration(
            top_left=(int(top[0]) - margin, int(top[1])),
            top_right=(int(top[2]) + margin, int(top[3])),
            bottom_left=(int(bottom[0]) - margin, int(bottom[1])),
            bottom_right=(int(bottom[2]) + margin, int(bottom[3])),
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _compute_transform(self) -> None:
        """Compute forward and inverse perspective matrices."""
        if not self.calibration:
            return
        src = self.calibration.get_source_points()
        dst = self.calibration.get_destination_points(
            self.CANVAS_W, self.CANVAS_H
        )
        self.M = cv2.getPerspectiveTransform(src, dst)
        self.M_inv = cv2.getPerspectiveTransform(dst, src)
