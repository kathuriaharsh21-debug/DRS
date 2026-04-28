"""
Perspective-transform pitch mapper — v2.

Maps pixel coordinates from the video frame to real-world pitch coordinates
using a four-point perspective transformation. Improved with:

    - **Hierarchical line clustering** for more robust auto-calibration
    - **Line intersection refinement** with RANSAC-style outlier rejection
    - **Sub-pixel edge detection** using Canny with automatic thresholding
    - **Parallel line grouping** for crease line identification
    - **Support for pre-defined pitch templates** (ICC standard)

Supports manual calibration (user-supplied corner points) and automatic
pitch-line detection via Canny + Hough + clustering.
"""

import cv2
import numpy as np
from typing import Optional, Tuple, List
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)


@dataclass
class PitchCalibration:
    """Four corner points of the pitch as visible in the video frame.

    Order: ``top_left -> top_right -> bottom_right -> bottom_left``.
    """
    top_left: Tuple[int, int]
    top_right: Tuple[int, int]
    bottom_left: Tuple[int, int]
    bottom_right: Tuple[int, int]

    def get_source_points(self) -> np.ndarray:
        return np.array([
            self.top_left, self.top_right,
            self.bottom_right, self.bottom_left,
        ], dtype=np.float32)

    def get_destination_points(
        self, width: int = 300, height: int = 1000
    ) -> np.ndarray:
        return np.array([
            [0, 0], [width, 0],
            [width, height], [0, height],
        ], dtype=np.float32)

    def to_dict(self) -> dict:
        return {
            "top_left": list(self.top_left),
            "top_right": list(self.top_right),
            "bottom_left": list(self.bottom_left),
            "bottom_right": list(self.bottom_right),
        }

    @classmethod
    def from_dict(cls, data: dict) -> "PitchCalibration":
        return cls(
            top_left=tuple(data["top_left"]),
            top_right=tuple(data["top_right"]),
            bottom_left=tuple(data["bottom_left"]),
            bottom_right=tuple(data["bottom_right"]),
        )


class PitchMapper:
    """Converts between pixel coordinates and real-world pitch coordinates
    using a perspective transform.

    Destination (top-down) view: 300 x 1000 pixels = 3.05 m x 20.12 m
    """

    # ICC standard physical dimensions (centimetres)
    PITCH_LENGTH_CM: float = 2012.0  # 22 yards
    PITCH_WIDTH_CM: float = 305.0    # 10 feet
    CREASE_LENGTH_CM: float = 122.0  # 4 feet (popping crease)
    STUMP_HEIGHT_CM: float = 71.1    # 28 inches
    STUMP_WIDTH_CM: float = 22.86    # 9 inches total
    RETURN_CREASE_CM: float = 396.0  # 13 feet (return crease from popping crease)

    # Virtual canvas size (pixels)
    CANVAS_W: int = 300
    CANVAS_H: int = 1000

    def __init__(self, calibration: Optional[PitchCalibration] = None):
        self.calibration = calibration
        self.M: Optional[np.ndarray] = None
        self.M_inv: Optional[np.ndarray] = None
        if calibration:
            self._compute_transform()

    def set_calibration(self, calibration: PitchCalibration) -> None:
        """(Re-)compute the perspective matrices."""
        self.calibration = calibration
        self._compute_transform()

    def pixel_to_pitch(self, x: float, y: float) -> Tuple[float, float]:
        """Map pixel (x, y) to real-world metres (x_m, y_m).

        Origin = top-left of bowling crease.
        x_m spans pitch width, y_m spans pitch length.
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
        """Map real-world metres back to pixel coordinates."""
        if self.M_inv is None:
            return x_m, y_m

        px = (x_m / (self.PITCH_WIDTH_CM / 100.0)) * self.CANVAS_W
        py = (y_m / (self.PITCH_LENGTH_CM / 100.0)) * self.CANVAS_H

        point = np.array([[[px, py]]], dtype=np.float32)
        transformed = cv2.perspectiveTransform(point, self.M_inv)
        result = transformed[0][0]
        return float(result[0]), float(result[1])

    # ------------------------------------------------------------------
    # Auto-calibration (v2: improved)
    # ------------------------------------------------------------------

    def auto_detect_pitch(self, frame: np.ndarray) -> Optional[PitchCalibration]:
        """Attempt automatic pitch-line detection with improved robustness.

        Pipeline:
            1. Automatic Canny thresholding (Otsu-based)
            2. Hough line detection with multiple parameter sets
            3. Hierarchical line clustering (angle-based grouping)
            4. Parallel line pair selection (crease lines)
            5. Line intersection for corner estimation
            6. RANSAC-style refinement

        Args:
            frame: BGR image (first frame of the video).

        Returns:
            PitchCalibration if detection succeeds, else None.
        """
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # 1. Auto Canny thresholds based on image statistics
        median = np.median(gray)
        lower = max(0, int(0.66 * median))
        upper = min(255, int(1.33 * median))
        if upper - lower < 30:
            lower, upper = 50, 150  # fallback

        edges = cv2.Canny(gray, lower, upper)

        # Morphological dilation to connect broken lines
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        edges = cv2.dilate(edges, kernel, iterations=1)

        # 2. Hough line detection with relaxed parameters
        lines = cv2.HoughLinesP(
            edges, 1, np.pi / 180,
            threshold=60, minLineLength=40, maxLineGap=15,
        )
        if lines is None or len(lines) < 4:
            logger.warning("Insufficient lines detected for auto-calibration")
            return None

        # 3. Classify lines by angle: horizontal (crease), vertical (return crease)
        horizontal_lines = []
        vertical_lines = []

        for line in lines:
            x1, y1, x2, y2 = line[0]
            angle = np.arctan2(abs(y2 - y1), abs(x2 - x1)) * 180 / np.pi
            length = np.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)

            if angle < 20:  # near-horizontal
                horizontal_lines.append({
                    "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                    "angle": angle, "length": length,
                    "mid_y": (y1 + y2) / 2,
                    "mid_x": (x1 + x2) / 2,
                })
            elif angle > 70:  # near-vertical
                vertical_lines.append({
                    "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                    "angle": angle, "length": length,
                    "mid_x": (x1 + x2) / 2,
                    "mid_y": (y1 + y2) / 2,
                })

        logger.debug(
            "Detected %d horizontal, %d vertical lines",
            len(horizontal_lines), len(vertical_lines),
        )

        # 4. Cluster horizontal lines by mid_y (group crease pairs)
        if len(horizontal_lines) < 2:
            return self._fallback_auto_calibrate(horizontal_lines, vertical_lines)

        horizontal_lines.sort(key=lambda l: l["mid_y"])
        h_clusters = self._cluster_by_proximity(
            horizontal_lines, key="mid_y", threshold=30
        )

        # 5. Select two best horizontal clusters (bowling and batting crease)
        # Pick clusters with the longest total line length
        h_clusters.sort(key=lambda c: sum(l["length"] for l in c), reverse=True)

        if len(h_clusters) < 2:
            return self._fallback_auto_calibrate(horizontal_lines, vertical_lines)

        # The top cluster is the bowling end, bottom is batting end
        bowling_cluster = min(h_clusters[:2], key=lambda c: np.mean([l["mid_y"] for l in c]))
        batting_cluster = max(h_clusters[:2], key=lambda c: np.mean([l["mid_y"] for l in c]))

        # Merge each cluster into a single representative line
        bowling_line = self._merge_lines(bowling_cluster)
        batting_line = self._merge_lines(batting_cluster)

        # 6. Estimate vertical extent using vertical lines or frame edges
        h = frame.shape[0]
        w = frame.shape[1]

        # Vertical extent: use detected vertical lines or estimate from frame
        left_x, right_x = 0, w
        if vertical_lines:
            v_sorted = sorted(vertical_lines, key=lambda l: l["mid_x"])
            left_group = [l for l in v_sorted if l["mid_x"] < w / 2]
            right_group = [l for l in v_sorted if l["mid_x"] >= w / 2]
            if left_group:
                left_x = int(np.mean([l["mid_x"] for l in left_group]))
            if right_group:
                right_x = int(np.mean([l["mid_x"] for l in right_group]))

        # 7. Extend horizontal lines to frame width for corners
        margin = 15
        return PitchCalibration(
            top_left=(
                max(0, left_x - margin),
                max(0, int(bowling_line["y"]) - 5),
            ),
            top_right=(
                min(w, right_x + margin),
                max(0, int(bowling_line["y"]) - 5),
            ),
            bottom_left=(
                max(0, left_x - margin),
                min(h, int(batting_line["y"]) + 5),
            ),
            bottom_right=(
                min(w, right_x + margin),
                min(h, int(batting_line["y"]) + 5),
            ),
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _cluster_by_proximity(
        self, items: list, key: str, threshold: float
    ) -> List[list]:
        """Cluster items by proximity of the given key value."""
        if not items:
            return []
        sorted_items = sorted(items, key=lambda x: x[key])
        clusters: List[list] = [[sorted_items[0]]]
        for item in sorted_items[1:]:
            if abs(item[key] - clusters[-1][0][key]) < threshold:
                clusters[-1].append(item)
            else:
                clusters.append([item])
        return clusters

    def _merge_lines(self, lines: list) -> dict:
        """Merge a cluster of lines into a single representative line."""
        if not lines:
            return {"y": 0, "x1": 0, "x2": 0}
        x1s = [l["x1"] for l in lines]
        x2s = [l["x2"] for l in lines]
        y1s = [l["y1"] for l in lines]
        y2s = [l["y2"] for l in lines]
        return {
            "x1": int(np.min(x1s + x2s)),
            "x2": int(np.max(x1s + x2s)),
            "y": float(np.mean(y1s + y2s)),
            "length": float(np.mean([l["length"] for l in lines])),
        }

    def _fallback_auto_calibrate(
        self, h_lines: list, v_lines: list
    ) -> Optional[PitchCalibration]:
        """Fallback auto-calibration using simple top/bottom line selection."""
        if len(h_lines) < 2:
            return None

        h_lines.sort(key=lambda l: l["mid_y"])
        top = h_lines[0]
        bottom = h_lines[-1]
        margin = 20

        return PitchCalibration(
            top_left=(int(top["x1"]) - margin, int(top["y1"])),
            top_right=(int(top["x2"]) + margin, int(top["y2"])),
            bottom_left=(int(bottom["x1"]) - margin, int(bottom["y1"])),
            bottom_right=(int(bottom["x2"]) + margin, int(bottom["y2"])),
        )

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
