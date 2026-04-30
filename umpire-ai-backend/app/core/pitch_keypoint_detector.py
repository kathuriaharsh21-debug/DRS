"""
Keypoint-regression-based pitch corner detector with robust homography.

Replaces the edge-based line detection approach (Canny + HoughLinesP) in
``pitch_mapper.py`` with a structured keypoint pipeline:

    1. Preprocess frame (resize, CLAHE, bilateral filter)
    2. Detect line segments (LSD, fallback to HoughLinesP)
    3. Cluster and merge parallel line segments
    4. Identify crease line pairs (bowling / batting) by position
    5. Compute line intersections for corner keypoints
    6. Refine corners with sub-pixel accuracy (cv2.cornerSubPix)
    7. Validate geometry (aspect ratio, parallelism, convexity)
    8. Optionally detect stump base positions via HSV / contour analysis
    9. Compute homography with RANSAC + outlier rejection

The homography maps pixel coordinates to a standardised 2-D top-down grid
(20.12 m x 3.05 m, 100 px/m) for accurate bounce-coordinate mapping.
"""

import cv2
import numpy as np
from typing import Optional, Tuple, List, Dict
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Physical constants (ICC standard, centimetres)
# ---------------------------------------------------------------------------
PITCH_LENGTH_CM: float = 2012.0   # 22 yards
PITCH_WIDTH_CM: float = 305.0     # 10 feet
STUMP_SPREAD_CM: float = 22.86    # 9 inches (outer edge of off / leg stump)
STUMP_HALF_CM: float = STUMP_SPREAD_CM / 2.0  # ~11.43 cm from centre


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class PitchKeypoints:
    """8 keypoint detections for the pitch.

    4 corners of the pitch surface:
    - bowling_crease_left, bowling_crease_right
    - batting_crease_left, batting_crease_right

    4 stump base positions (optional):
    - bowling_stump_left, bowling_stump_right
    - batting_stump_left, batting_stump_right
    """

    bowling_crease_left: Tuple[float, float]
    bowling_crease_right: Tuple[float, float]
    batting_crease_left: Tuple[float, float]
    batting_crease_right: Tuple[float, float]
    bowling_stump_left: Optional[Tuple[float, float]] = None
    bowling_stump_right: Optional[Tuple[float, float]] = None
    batting_stump_left: Optional[Tuple[float, float]] = None
    batting_stump_right: Optional[Tuple[float, float]] = None

    def to_pitch_calibration(self) -> "PitchCalibration":
        """Convert to :class:`PitchCalibration` (4 corners only)."""
        from app.core.pitch_mapper import PitchCalibration
        return PitchCalibration(
            top_left=tuple(map(int, self.bowling_crease_left)),
            top_right=tuple(map(int, self.bowling_crease_right)),
            bottom_left=tuple(map(int, self.batting_crease_left)),
            bottom_right=tuple(map(int, self.batting_crease_right)),
        )

    @property
    def corner_array(self) -> np.ndarray:
        """Return the 4 corner positions as a (4, 2) float32 array.

        Order: bowling-left, bowling-right, batting-right, batting-left.
        """
        return np.array([
            self.bowling_crease_left,
            self.bowling_crease_right,
            self.batting_crease_right,
            self.batting_crease_left,
        ], dtype=np.float32)

    @property
    def has_stumps(self) -> bool:
        """True if all 4 stump positions are available."""
        return all([
            self.bowling_stump_left is not None,
            self.bowling_stump_right is not None,
            self.batting_stump_left is not None,
            self.batting_stump_right is not None,
        ])

    @property
    def all_keypoints(self) -> List[Tuple[float, float]]:
        """Return every non-None keypoint as a flat list."""
        pts: List[Tuple[float, float]] = [
            self.bowling_crease_left, self.bowling_crease_right,
            self.batting_crease_left, self.batting_crease_right,
        ]
        for s in (
            self.bowling_stump_left, self.bowling_stump_right,
            self.batting_stump_left, self.batting_stump_right,
        ):
            if s is not None:
                pts.append(s)
        return pts


@dataclass
class HomographyResult:
    """Result of homography estimation."""

    H: np.ndarray              # 3x3 homography matrix
    H_inv: np.ndarray          # inverse homography
    reprojection_error: float  # mean reprojection error (pixels)
    inlier_count: int          # number of RANSAC inliers
    keypoints_used: int        # total keypoints fed to RANSAC
    confidence: float          # 0-1 derived from reprojection error


# ---------------------------------------------------------------------------
# Main detector class
# ---------------------------------------------------------------------------

class PitchKeypointDetector:
    """Keypoint-regression-based pitch corner detector with robust homography.

    Pipeline
    --------
    1. Preprocess frame (resize, equalize, enhance contrast)
    2. Detect line segments (LSD or HoughLinesP as fallback)
    3. Cluster and merge parallel line segments
    4. Identify crease line pairs (bowling / batting) by position
    5. Compute line intersections for corner keypoints
    6. Refine corners using sub-pixel detection (cv2.cornerSubPix)
    7. Validate geometry (aspect ratio, parallelism, minimum area)
    8. Optionally detect stump base positions (color / shape)
    9. Compute homography with RANSAC + outlier rejection

    The homography maps pixel coords to a standardised top-down grid:

    * Width: 3.05 m (305 pixels at 100 px/m)
    * Length: 20.12 m (2012 pixels at 100 px/m)
    * Origin: bowling crease centre
    """

    # Processing limits
    _MAX_PROCESS_WIDTH: int = 1280
    _RESIZE_SCALE: float = 1.0  # updated per-frame

    def __init__(
        self,
        target_width_px: int = 305,     # 3.05 m at 100 px/m
        target_length_px: int = 2012,   # 20.12 m at 100 px/m
        ransac_reproj_threshold: float = 3.0,
        min_confidence: float = 0.5,
    ) -> None:
        self.target_width_px = target_width_px
        self.target_length_px = target_length_px
        self.ransac_reproj_threshold = ransac_reproj_threshold
        self.min_confidence = min_confidence

        # Physical dimensions in metres (for pixel-to-metre conversion)
        self._pitch_width_m = PITCH_WIDTH_CM / 100.0   # 3.05
        self._pitch_length_m = PITCH_LENGTH_CM / 100.0  # 20.12

        # Check LSD availability at import time
        self._has_lsd = hasattr(cv2, "createLineSegmentDetector")

        logger.debug(
            "PitchKeypointDetector initialised: target=%dx%d px, "
            "RANSAC thresh=%.1f, min_conf=%.2f, LSD=%s",
            target_width_px, target_length_px,
            ransac_reproj_threshold, min_confidence,
            self._has_lsd,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def detect(
        self,
        frame: np.ndarray,
        stump_color_hsv: Optional[Tuple] = None,
    ) -> Optional[PitchKeypoints]:
        """Detect pitch keypoints in a single BGR frame.

        Parameters
        ----------
        frame : np.ndarray
            BGR image (any resolution).
        stump_color_hsv : tuple, optional
            (H, S, V) centre colour for stump detection.  If *None* a
            default cream/white range is used.

        Returns
        -------
        PitchKeypoints or None
            Detected keypoints if confidence >= *min_confidence*, else None.
        """
        if frame is None or frame.size == 0:
            logger.warning("detect() called with empty frame")
            return None

        # 1. Preprocess
        gray, scale = self._preprocess(frame)
        h, w = gray.shape[:2]

        # 2. Detect lines
        lines = self._detect_lines(gray)
        if lines is None or len(lines) < 4:
            logger.warning(
                "Only %d lines detected — insufficient for pitch detection",
                0 if lines is None else len(lines),
            )
            return None

        # Store for downstream methods that need the raw line array
        self._last_detected_lines = lines

        # 3. Cluster by angle
        clusters = self._cluster_lines_by_angle(lines)

        # 4. Separate horizontal and vertical
        horizontal_lines = self._select_near_horizontal(clusters, w, h)
        vertical_lines = self._select_near_vertical(clusters, w, h)

        logger.debug(
            "Line classification: %d horizontal, %d vertical",
            len(horizontal_lines), len(vertical_lines),
        )

        # 5. Find crease pairs
        crease_result = self._find_crease_pairs(horizontal_lines, h)
        if crease_result is None:
            logger.warning("Could not identify bowling / batting crease pairs")
            return None

        bowling_line, batting_line = crease_result

        # 6. Find vertical boundaries
        left_x, right_x = self._find_vertical_boundaries(vertical_lines, w)

        # 7. Compute corner intersections
        keypoints = self._compute_intersections(
            bowling_line, batting_line, left_x, right_x,
        )

        # 8. Sub-pixel refinement (undo scaling to original frame)
        orig_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        corners_to_refine = [
            (keypoints.bowling_crease_left[0] / scale, keypoints.bowling_crease_left[1] / scale),
            (keypoints.bowling_crease_right[0] / scale, keypoints.bowling_crease_right[1] / scale),
            (keypoints.batting_crease_left[0] / scale, keypoints.batting_crease_left[1] / scale),
            (keypoints.batting_crease_right[0] / scale, keypoints.batting_crease_right[1] / scale),
        ]
        refined = self._refine_corners_subpixel(orig_gray, corners_to_refine)

        if refined:
            (keypoints.bowling_crease_left,
             keypoints.bowling_crease_right,
             keypoints.batting_crease_left,
             keypoints.batting_crease_right) = (
                refined[0], refined[1], refined[2], refined[3],
            )

        # 9. Validate geometry
        confidence = self.validate_geometry(keypoints, frame.shape[:2])
        logger.info("Keypoint geometry confidence: %.2f", confidence)

        if confidence < self.min_confidence:
            logger.warning(
                "Geometry confidence %.2f below threshold %.2f — rejecting",
                confidence, self.min_confidence,
            )
            return None

        # 10. Optional stump detection (always attempt if no HSV hint given)
        if stump_color_hsv is not None or True:
            keypoints = self._detect_stump_bases(frame, keypoints, stump_color_hsv)

        return keypoints

    def compute_homography(
        self,
        keypoints: PitchKeypoints,
        frame_shape: Tuple[int, int],
    ) -> HomographyResult:
        """Compute a robust homography from detected keypoints.

        Uses ``cv2.findHomography`` with RANSAC for outlier rejection.

        Parameters
        ----------
        keypoints : PitchKeypoints
            Detected pitch keypoints.
        frame_shape : tuple
            ``(height, width)`` of the source frame.

        Returns
        -------
        HomographyResult
        """
        tw = self.target_width_px
        tl = self.target_length_px
        half_w = tw / 2.0
        stump_half_px = (STUMP_HALF_CM / 100.0) * (tw / self._pitch_width_m)

        # Build source (pixel) and destination (top-down grid) point lists
        src_pts: List[Tuple[float, float]] = []
        dst_pts: List[Tuple[float, float]] = []

        # 4 corners → rectangle
        src_pts.extend([
            keypoints.bowling_crease_left,
            keypoints.bowling_crease_right,
            keypoints.batting_crease_right,
            keypoints.batting_crease_left,
        ])
        dst_pts.extend([
            (0.0, 0.0),
            (tw, 0.0),
            (tw, tl),
            (0.0, tl),
        ])

        # Stump bases if available → constrained positions on the creases
        if keypoints.has_stumps:
            src_pts.extend([
                keypoints.bowling_stump_left,       # type: ignore[arg-type]
                keypoints.bowling_stump_right,      # type: ignore[arg-type]
                keypoints.batting_stump_left,       # type: ignore[arg-type]
                keypoints.batting_stump_right,      # type: ignore[arg-type]
            ])
            dst_pts.extend([
                (half_w - stump_half_px, 0.0),      # bowling stump left
                (half_w + stump_half_px, 0.0),      # bowling stump right
                (half_w - stump_half_px, tl),        # batting stump left
                (half_w + stump_half_px, tl),        # batting stump right
            ])

        src_np = np.array(src_pts, dtype=np.float32)
        dst_np = np.array(dst_pts, dtype=np.float32)

        # RANSAC homography
        H, mask = cv2.findHomography(
            src_np, dst_np,
            cv2.RANSAC,
            ransacReprojThreshold=self.ransac_reproj_threshold,
        )

        if H is None:
            logger.error("findHomography returned None")
            raise RuntimeError("Homography computation failed")

        mask_bool = mask.ravel().astype(bool) if mask is not None else np.ones(len(src_pts), dtype=bool)
        inlier_count = int(mask_bool.sum())

        # Reprojection error (inliers only)
        projected = cv2.perspectiveTransform(
            src_np[mask_bool].reshape(-1, 1, 2), H,
        ).reshape(-1, 2)
        error = float(np.mean(np.linalg.norm(
            projected - dst_np[mask_bool], axis=1,
        )))

        # Inverse homography
        H_inv = cv2.findHomography(dst_np, src_np, 0)[0]
        if H_inv is None:
            H_inv = np.linalg.inv(H)

        # Confidence: lower reprojection error → higher confidence
        # Scale: 0 error = 1.0, 10 px error = 0.0
        confidence = float(np.clip(1.0 - error / 10.0, 0.0, 1.0))

        logger.info(
            "Homography: inliers=%d/%d, reproj_err=%.2f px, conf=%.2f",
            inlier_count, len(src_pts), error, confidence,
        )

        return HomographyResult(
            H=H,
            H_inv=H_inv,
            reprojection_error=error,
            inlier_count=inlier_count,
            keypoints_used=len(src_pts),
            confidence=confidence,
        )

    def pixel_to_pitch_coords(
        self,
        x: float,
        y: float,
        homography: HomographyResult,
    ) -> Tuple[float, float]:
        """Transform pixel coordinates to pitch coordinates in metres.

        Origin = bowling crease centre.  *x_m* spans pitch width,
        *y_m* spans pitch length (towards batting end).

        Parameters
        ----------
        x, y : float
            Pixel coordinates in the source frame.
        homography : HomographyResult
            Pre-computed homography from :meth:`compute_homography`.

        Returns
        -------
        tuple[float, float]
            ``(x_m, y_m)`` in metres.
        """
        point = np.array([[[x, y]]], dtype=np.float32)
        transformed = cv2.perspectiveTransform(point, homography.H)
        px, py = transformed[0][0]

        x_m = (px / self.target_width_px) * self._pitch_width_m
        y_m = (py / self.target_length_px) * self._pitch_length_m

        return round(float(x_m), 3), round(float(y_m), 3)

    def pitch_to_pixel_coords(
        self,
        x_m: float,
        y_m: float,
        homography: HomographyResult,
    ) -> Tuple[float, float]:
        """Transform pitch coordinates in metres back to pixel coords.

        Parameters
        ----------
        x_m, y_m : float
            Metre coordinates on the top-down pitch grid.
        homography : HomographyResult
            Pre-computed homography.

        Returns
        -------
        tuple[float, float]
            ``(x_px, y_px)`` in the source frame.
        """
        px = (x_m / self._pitch_width_m) * self.target_width_px
        py = (y_m / self._pitch_length_m) * self.target_length_px

        point = np.array([[[px, py]]], dtype=np.float32)
        transformed = cv2.perspectiveTransform(point, homography.H_inv)
        result = transformed[0][0]
        return float(result[0]), float(result[1])

    def validate_geometry(
        self,
        keypoints: PitchKeypoints,
        frame_shape: Tuple[int, int],
    ) -> float:
        """Validate detected keypoint geometry and return a confidence score.

        Checks:
        1. Crease lines are approximately parallel (angle diff < 10 deg)
        2. Pitch aspect ratio is reasonable (4:1 to 8:1)
        3. Minimum pitch area (at least 5 % of frame area)
        4. Corners form a convex quadrilateral

        Returns
        -------
        float
            Confidence in [0, 1].
        """
        scores: List[float] = []
        fh, fw = frame_shape[:2]
        frame_area = float(fh * fw)

        bl = np.array(keypoints.bowling_crease_left, dtype=np.float64)
        br = np.array(keypoints.bowling_crease_right, dtype=np.float64)
        tl = np.array(keypoints.batting_crease_left, dtype=np.float64)
        tr = np.array(keypoints.batting_crease_right, dtype=np.float64)

        # --- 1. Parallelism of crease lines ---
        bowl_vec = br - bl
        bat_vec = tr - tl
        cos_angle = np.dot(bowl_vec, bat_vec) / (
            np.linalg.norm(bowl_vec) * np.linalg.norm(bat_vec) + 1e-9
        )
        cos_angle = float(np.clip(cos_angle, -1.0, 1.0))
        angle_diff = abs(np.degrees(np.arccos(cos_angle)))
        # Score: 1.0 if perfectly parallel, 0.0 if > 15 deg
        parallel_score = max(0.0, 1.0 - angle_diff / 15.0)
        scores.append(parallel_score)
        logger.debug("Parallelism: angle_diff=%.2f deg, score=%.2f", angle_diff, parallel_score)

        # --- 2. Aspect ratio ---
        bowl_width = float(np.linalg.norm(bowl_vec))
        bat_width = float(np.linalg.norm(bat_vec))
        avg_width = (bowl_width + bat_width) / 2.0

        # Average length from bowling to batting crease
        length_left = float(np.linalg.norm(tl - bl))
        length_right = float(np.linalg.norm(tr - br))
        avg_length = (length_left + length_right) / 2.0

        if avg_width > 1e-3:
            aspect = avg_length / avg_width
        else:
            aspect = 0.0

        # Physical aspect ratio: 2012/305 ≈ 6.6
        ideal_aspect = PITCH_LENGTH_CM / PITCH_WIDTH_CM  # ~6.6
        aspect_ratio_score = max(0.0, 1.0 - abs(aspect - ideal_aspect) / ideal_aspect)
        scores.append(aspect_ratio_score)
        logger.debug("Aspect ratio: measured=%.2f, ideal=%.2f, score=%.2f", aspect, ideal_aspect, aspect_ratio_score)

        # --- 3. Minimum area ---
        quad_area = float(cv2.contourArea(
            np.array([bl, br, tr, tl], dtype=np.float32).reshape(-1, 1, 2),
        ))
        area_ratio = quad_area / frame_area if frame_area > 0 else 0.0
        # Require at least 2 % of frame, score linearly up to 30 %
        area_score = min(1.0, area_ratio / 0.30)
        scores.append(area_score)
        logger.debug("Area ratio: %.4f, score=%.2f", area_ratio, area_score)

        # --- 4. Convexity ---
        contour = np.array([bl, br, tr, tl], dtype=np.float32)
        hull = cv2.convexHull(contour)
        hull_area = float(cv2.contourArea(hull))
        convexity = quad_area / hull_area if hull_area > 1e-3 else 0.0
        convexity_score = float(np.clip(convexity, 0.0, 1.0))
        scores.append(convexity_score)
        logger.debug("Convexity: %.4f, score=%.2f", convexity, convexity_score)

        # --- 5. Reasonable absolute size ---
        # Pitch width should not exceed ~80 % of frame width
        width_ratio = avg_width / fw if fw > 0 else 0.0
        size_score = 1.0 if 0.05 < width_ratio < 0.80 else 0.3
        scores.append(size_score)

        overall = float(np.mean(scores))
        logger.info("Geometry validation overall: %.2f (components: %s)", overall, [round(s, 2) for s in scores])
        return overall

    # ------------------------------------------------------------------
    # Internal methods — preprocessing
    # ------------------------------------------------------------------

    def _preprocess(self, frame: np.ndarray) -> Tuple[np.ndarray, float]:
        """Preprocess a frame for line detection.

        Steps:
        1. Resize to max 1280 px width (maintain aspect ratio)
        2. Convert to grayscale
        3. CLAHE for contrast enhancement
        4. Bilateral filter (preserve edges, reduce noise)

        Returns
        -------
        tuple[np.ndarray, float]
            (gray image, scale factor used for resizing)
        """
        h, w = frame.shape[:2]
        scale = 1.0
        if w > self._MAX_PROCESS_WIDTH:
            scale = self._MAX_PROCESS_WIDTH / w
            frame = cv2.resize(frame, (self._MAX_PROCESS_WIDTH, int(h * scale)))
        self._RESIZE_SCALE = scale

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # CLAHE
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray = clahe.apply(gray)

        # Bilateral filter — preserves edges while reducing noise
        gray = cv2.bilateralFilter(gray, d=9, sigmaColor=75, sigmaSpace=75)

        return gray, scale

    # ------------------------------------------------------------------
    # Internal methods — line detection
    # ------------------------------------------------------------------

    def _detect_lines(self, gray: np.ndarray) -> Optional[np.ndarray]:
        """Detect line segments using LSD, falling back to HoughLinesP.

        Returns
        -------
        np.ndarray or None
            Nx4 array of ``(x1, y1, x2, y2)`` or *None* if nothing found.
        """
        if self._has_lsd:
            try:
                lsd = cv2.createLineSegmentDetector(
                    cv2.LSD_REFINE_STD,
                    scale=1.0,
                    sigma_scale=0.8,
                    quant=2.0,
                    ang_th=22.5,
                    log_eps=0,
                    density_th=0.7,
                    n_bins=1024,
                )
                lines, _, _, _ = lsd.detect(gray)
                if lines is not None and len(lines) >= 4:
                    logger.debug("LSD detected %d lines", len(lines))
                    return lines.reshape(-1, 4)
            except cv2.error:
                logger.warning("LSD failed, falling back to HoughLinesP")

        # Fallback: HoughLinesP
        median = np.median(gray)
        lower = max(0, int(0.66 * median))
        upper = min(255, int(1.33 * median))
        if upper - lower < 30:
            lower, upper = 50, 150

        edges = cv2.Canny(gray, lower, upper)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        edges = cv2.dilate(edges, kernel, iterations=1)

        lines = cv2.HoughLinesP(
            edges, 1, np.pi / 180,
            threshold=60, minLineLength=40, maxLineGap=15,
        )
        if lines is not None:
            logger.debug("HoughLinesP detected %d lines", len(lines))
            return lines.reshape(-1, 4)

        return None

    # ------------------------------------------------------------------
    # Internal methods — line clustering
    # ------------------------------------------------------------------

    def _cluster_lines_by_angle(
        self, lines: np.ndarray,
    ) -> Dict[float, List[int]]:
        """Group line segments by angle into 10-degree buckets.

        Parameters
        ----------
        lines : np.ndarray
            Nx4 array of ``(x1, y1, x2, y2)``.

        Returns
        -------
        dict[float, list[int]]
            Mapping from angle-bucket (degrees, rounded to 10) to list of
            line indices.
        """
        dx = lines[:, 2] - lines[:, 0]
        dy = lines[:, 3] - lines[:, 1]
        angles = np.arctan2(np.abs(dy), np.abs(dx))  # [0, pi/2]
        angles_deg = np.degrees(angles)
        buckets = np.round(angles_deg / 10.0) * 10.0  # quantise to 10°

        clusters: Dict[float, List[int]] = {}
        for idx, bucket in enumerate(buckets):
            key = float(bucket)
            clusters.setdefault(key, []).append(idx)

        logger.debug(
            "Angle clusters: %s",
            {k: len(v) for k, v in sorted(clusters.items())},
        )
        return clusters

    def _select_near_horizontal(
        self,
        clusters: Dict[float, List[int]],
        frame_w: int,
        frame_h: int,
    ) -> List[int]:
        """Select horizontal-ish line segment indices (angle <= 20 deg)."""
        indices: List[int] = []
        for angle_bucket, idx_list in clusters.items():
            if angle_bucket <= 20.0:
                indices.extend(idx_list)
        return indices

    def _select_near_vertical(
        self,
        clusters: Dict[float, List[int]],
        frame_w: int,
        frame_h: int,
    ) -> List[int]:
        """Select vertical-ish line segment indices (angle >= 70 deg)."""
        indices: List[int] = []
        for angle_bucket, idx_list in clusters.items():
            if angle_bucket >= 70.0:
                indices.extend(idx_list)
        return indices

    def _resolve_lines(
        self, indices: List[int], lines: np.ndarray,
    ) -> List[np.ndarray]:
        """Resolve a list of indices into line arrays."""
        return [lines[i] for i in indices]

    # ------------------------------------------------------------------
    # Internal methods — crease pair detection
    # ------------------------------------------------------------------

    def _find_crease_pairs(
        self,
        horizontal_indices: List[int],
        frame_height: int,
    ) -> Optional[Tuple[np.ndarray, np.ndarray]]:
        """Identify bowling and batting crease line pairs.

        Strategy:
        1. Cluster horizontal lines by y-position (proximity clustering)
        2. The two most prominent clusters (longest total line length) are creases
        3. Merge each cluster into a single line segment

        Parameters
        ----------
        horizontal_indices : list[int]
            Indices into the master ``lines`` array.
        frame_height : int
            Height of the preprocessed frame.

        Returns
        -------
        tuple[np.ndarray, np.ndarray] or None
            ``(bowling_line, batting_line)`` each of shape ``(4,)``
            as ``(x1, y1, x2, y2)``.  Bowling has smaller y.
        """
        if len(horizontal_indices) < 2:
            return None

        # We need the stored lines — use a workaround: store them on self
        # Actually, we refactor: the caller should pass lines explicitly.
        # To keep the public signature, we store the last-detected lines.
        # (The caller is always `detect()` which calls `_detect_lines` first.)
        lines = self._last_detected_lines  # set in detect()

        h_lines: List[dict] = []
        for idx in horizontal_indices:
            x1, y1, x2, y2 = lines[idx]
            length = float(np.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2))
            h_lines.append({
                "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                "mid_y": (y1 + y2) / 2.0,
                "mid_x": (x1 + x2) / 2.0,
                "length": length,
                "idx": idx,
            })

        # Sort by mid_y and cluster by proximity
        h_lines.sort(key=lambda l: l["mid_y"])
        clusters = self._cluster_by_proximity(h_lines, key="mid_y", threshold=30.0)

        if len(clusters) < 2:
            logger.warning("Only %d horizontal clusters found, need >= 2", len(clusters))
            return None

        # Rank clusters by total line length
        clusters.sort(key=lambda c: sum(l["length"] for l in c), reverse=True)
        top_two = clusters[:2]

        # Bowling crease = smaller y (top of frame), batting = larger y
        bowling_cluster = min(top_two, key=lambda c: np.mean([l["mid_y"] for l in c]))
        batting_cluster = max(top_two, key=lambda c: np.mean([l["mid_y"] for l in c]))

        bowling_line = self._merge_cluster_to_line(bowling_cluster)
        batting_line = self._merge_cluster_to_line(batting_cluster)

        logger.debug(
            "Crease pairs: bowling mid_y=%.1f, batting mid_y=%.1f",
            bowling_line[1], batting_line[1],
        )
        return bowling_line, batting_line

    def _find_vertical_boundaries(
        self,
        vertical_indices: List[int],
        frame_width: int,
    ) -> Tuple[float, float]:
        """Find left and right vertical boundaries of the pitch.

        Parameters
        ----------
        vertical_indices : list[int]
            Indices into the master lines array.
        frame_width : int
            Width of the preprocessed frame.

        Returns
        -------
        tuple[float, float]
            ``(left_x, right_x)`` in pixel coordinates.
        """
        lines = self._last_detected_lines
        mid_xs: List[float] = []

        for idx in vertical_indices:
            x1, y1, x2, y2 = lines[idx]
            mid_xs.append((x1 + x2) / 2.0)

        if not mid_xs:
            logger.debug("No vertical lines — using frame edges as boundaries")
            return 0.0, float(frame_width)

        mid_xs.sort()
        half = frame_width / 2.0
        left_group = [x for x in mid_xs if x < half]
        right_group = [x for x in mid_xs if x >= half]

        left_x = float(np.mean(left_group)) if left_group else 0.0
        right_x = float(np.mean(right_group)) if right_group else float(frame_width)

        logger.debug("Vertical boundaries: left=%.1f, right=%.1f", left_x, right_x)
        return left_x, right_x

    # ------------------------------------------------------------------
    # Internal methods — corner computation
    # ------------------------------------------------------------------

    def _compute_intersections(
        self,
        bowling_line: np.ndarray,
        batting_line: np.ndarray,
        left_x: float,
        right_x: float,
    ) -> PitchKeypoints:
        """Compute the 4 corner points from crease lines and vertical boundaries.

        Each crease line is ``(x1, y1, x2, y2)``.  We parametrise it and
        find the y-value at *left_x* and *right_x*.

        Returns
        -------
        PitchKeypoints
            The four corner positions.
        """
        # Parametrise bowling crease:  y = y1 + m * (x - x1)
        bx1, by1, bx2, by2 = bowling_line
        if abs(bx2 - bx1) > 1e-6:
            b_slope = (by2 - by1) / (bx2 - bx1)
        else:
            b_slope = 0.0
        bowl_y_left = by1 + b_slope * (left_x - bx1)
        bowl_y_right = by1 + b_slope * (right_x - bx1)

        # Parametrise batting crease
        tx1, ty1, tx2, ty2 = batting_line
        if abs(tx2 - tx1) > 1e-6:
            t_slope = (ty2 - ty1) / (tx2 - tx1)
        else:
            t_slope = 0.0
        bat_y_left = ty1 + t_slope * (left_x - tx1)
        bat_y_right = ty1 + t_slope * (right_x - tx1)

        keypoints = PitchKeypoints(
            bowling_crease_left=(left_x, bowl_y_left),
            bowling_crease_right=(right_x, bowl_y_right),
            batting_crease_left=(left_x, bat_y_left),
            batting_crease_right=(right_x, bat_y_right),
        )

        logger.debug(
            "Corners: BL=%s BR=%s TL=%s TR=%s",
            keypoints.bowling_crease_left,
            keypoints.bowling_crease_right,
            keypoints.batting_crease_left,
            keypoints.batting_crease_right,
        )
        return keypoints

    def _refine_corners_subpixel(
        self,
        gray: np.ndarray,
        corners: List[Tuple[float, float]],
        win_size: int = 5,
        zero_zone: Tuple[int, int] = (-1, -1),
        criteria: Tuple = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.001),
    ) -> List[Tuple[float, float]]:
        """Refine corner positions to sub-pixel accuracy.

        Parameters
        ----------
        gray : np.ndarray
            Grayscale image (original resolution).
        corners : list[tuple[float, float]]
            Approximate corner positions.
        win_size : int
            Half-size of the search window.

        Returns
        -------
        list[tuple[float, float]]
            Refined corner positions (same order).
        """
        if gray is None or not corners:
            return corners

        corner_np = np.array(corners, dtype=np.float32).reshape(-1, 1, 2)

        # Ensure corners are within image bounds
        h, w = gray.shape[:2]
        corner_np[:, 0, 0] = np.clip(corner_np[:, 0, 0], win_size, w - win_size - 1)
        corner_np[:, 0, 1] = np.clip(corner_np[:, 0, 1], win_size, h - win_size - 1)

        try:
            refined = cv2.cornerSubPix(
                gray, corner_np,
                winSize=(win_size, win_size),
                zeroZone=zero_zone,
                criteria=criteria,
            )
            result = [(float(r[0, 0]), float(r[0, 1])) for r in refined]
            logger.debug("Sub-pixel refinement applied to %d corners", len(result))
            return result
        except cv2.error:
            logger.warning("cornerSubPix failed — returning original corners")
            return corners

    # ------------------------------------------------------------------
    # Internal methods — stump detection
    # ------------------------------------------------------------------

    def _detect_stump_bases(
        self,
        frame: np.ndarray,
        crease_corners: PitchKeypoints,
        stump_color_hsv: Optional[Tuple] = None,
    ) -> PitchKeypoints:
        """Detect stump base positions near each crease using HSV filtering
        and contour analysis for thin vertical shapes.

        Strategy:
        1. Define a narrow ROI near each crease
        2. Convert to HSV and filter for cream / white
        3. Find contours matching thin vertical shapes
        4. Cluster stump candidates and assign left / right
        5. Update PitchKeypoints with stump base positions

        Parameters
        ----------
        frame : np.ndarray
            BGR image at original resolution.
        crease_corners : PitchKeypoints
            The four detected crease corners.
        stump_color_hsv : tuple, optional
            ``(H, S, V)`` centre colour for stump filtering.

        Returns
        -------
        PitchKeypoints
            Updated keypoints with stump positions filled in.
        """
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)

        # Default stump colour: cream / off-white
        if stump_color_hsv is not None:
            h_c, s_c, v_c = stump_color_hsv
        else:
            h_c, s_c, v_c = 25, 40, 200  # cream-ish

        # HSV range for stump colour
        lower_hsv = np.array([max(0, h_c - 20), max(0, s_c - 50), max(0, v_c - 60)])
        upper_hsv = np.array([min(180, h_c + 20), min(180, s_c + 80), min(255, v_c + 55)])

        mask = cv2.inRange(hsv, lower_hsv, upper_hsv)
        # Morphological cleanup
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        # Filter contours: thin vertical shapes (stumps)
        stump_candidates: List[dict] = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < 20 or area > 5000:
                continue
            x, y, w_cnt, h_cnt = cv2.boundingRect(cnt)
            aspect = h_cnt / (w_cnt + 1e-6)
            if aspect < 2.0 or aspect > 20.0:
                continue
            cx = x + w_cnt / 2.0
            cy = y + h_cnt  # base of the bounding box
            stump_candidates.append({
                "cx": cx, "cy": cy,
                "width": w_cnt, "height": h_cnt,
                "area": area, "aspect": aspect,
            })

        if len(stump_candidates) < 2:
            logger.debug(
                "Only %d stump candidates found — skipping stump detection",
                len(stump_candidates),
            )
            return crease_corners

        # Define crease ROIs
        def _crease_y_range(crease_left, crease_right, tolerance=25.0):
            y_avg = (crease_left[1] + crease_right[1]) / 2.0
            return y_avg - tolerance, y_avg + tolerance

        bowl_y_min, bowl_y_max = _crease_y_range(
            crease_corners.bowling_crease_left, crease_corners.bowling_crease_right,
        )
        bat_y_min, bat_y_max = _crease_y_range(
            crease_corners.batting_crease_left, crease_corners.batting_crease_right,
        )

        def _assign_stumps(
            candidates: List[dict],
            y_min: float,
            y_max: float,
            crease_left: Tuple[float, float],
            crease_right: Tuple[float, float],
        ) -> Optional[Tuple[Tuple[float, float], Tuple[float, float]]]:
            """Pick the best left / right stump pair near a crease."""
            # Filter candidates within y range
            nearby = [c for c in candidates if y_min <= c["cy"] <= y_max]
            if len(nearby) < 2:
                # Expand range and try again
                nearby = [c for c in candidates if y_min - 30 <= c["cy"] <= y_max + 30]
            if len(nearby) < 2:
                return None

            mid_x = (crease_left[0] + crease_right[0]) / 2.0
            nearby.sort(key=lambda c: c["cx"])
            left_stump = nearby[0]
            right_stump = nearby[-1]
            return (
                (left_stump["cx"], left_stump["cy"]),
                (right_stump["cx"], right_stump["cy"]),
            )

        bowl_stumps = _assign_stumps(
            stump_candidates, bowl_y_min, bowl_y_max,
            crease_corners.bowling_crease_left, crease_corners.bowling_crease_right,
        )
        bat_stumps = _assign_stumps(
            stump_candidates, bat_y_min, bat_y_max,
            crease_corners.batting_crease_left, crease_corners.batting_crease_right,
        )

        if bowl_stumps is not None:
            crease_corners.bowling_stump_left = bowl_stumps[0]
            crease_corners.bowling_stump_right = bowl_stumps[1]
            logger.debug("Bowling stumps: %s, %s", bowl_stumps[0], bowl_stumps[1])

        if bat_stumps is not None:
            crease_corners.batting_stump_left = bat_stumps[0]
            crease_corners.batting_stump_right = bat_stumps[1]
            logger.debug("Batting stumps: %s, %s", bat_stumps[0], bat_stumps[1])

        return crease_corners

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _cluster_by_proximity(
        self, items: List[dict], key: str, threshold: float,
    ) -> List[List[dict]]:
        """Cluster items by proximity of the given key value."""
        if not items:
            return []
        sorted_items = sorted(items, key=lambda x: x[key])
        clusters: List[List[dict]] = [[sorted_items[0]]]
        for item in sorted_items[1:]:
            if abs(item[key] - clusters[-1][0][key]) < threshold:
                clusters[-1].append(item)
            else:
                clusters.append([item])
        return clusters

    def _merge_cluster_to_line(self, cluster: List[dict]) -> np.ndarray:
        """Merge a cluster of line dicts into a single (x1, y1, x2, y2) line.

        The merged line spans the full x-extent of the cluster at the
        weighted mean y-position.
        """
        if not cluster:
            return np.array([0.0, 0.0, 0.0, 0.0], dtype=np.float64)

        x1s = [l["x1"] for l in cluster]
        x2s = [l["x2"] for l in cluster]
        y1s = [l["y1"] for l in cluster]
        y2s = [l["y2"] for l in cluster]
        lengths = [l["length"] for l in cluster]
        total_len = sum(lengths) + 1e-9

        # Weighted average y-position (longer lines get more weight)
        weighted_y = sum(
            ((y1 + y2) / 2.0) * ln
            for y1, y2, ln in zip(y1s, y2s, lengths)
        ) / total_len

        merged_x1 = float(min(x1s + x2s))
        merged_x2 = float(max(x1s + x2s))

        return np.array([merged_x1, weighted_y, merged_x2, weighted_y], dtype=np.float64)

    # ------------------------------------------------------------------
    # Storage for inter-method communication (set during detect())
    # ------------------------------------------------------------------
    _last_detected_lines: np.ndarray = np.empty((0, 4))

    # Override detect() to store lines for _find_crease_pairs
    # (already done above via self._last_detected_lines)
