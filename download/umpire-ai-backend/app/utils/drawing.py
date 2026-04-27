"""
OpenCV drawing utilities for annotating video frames.

Provides Hawk-Eye–style visual overlays: trajectory path, ball glow,
pitch markings, stump visualisation, PITCH/IMPACT labels, and a
semi-transparent prediction zone.
"""

import cv2
import numpy as np
from typing import Optional, List, Tuple


# ======================================================================
# Colour palette
# ======================================================================

# BGR tuples
COLOR_GREEN = (0, 200, 0)
COLOR_AMBER = (0, 180, 255)
COLOR_RED = (0, 0, 255)
COLOR_WHITE = (255, 255, 255)
COLOR_BLACK = (0, 0, 0)
COLOR_YELLOW = (0, 255, 255)
COLOR_CYAN = (255, 255, 0)
COLOR_BLUE = (255, 0, 0)
COLOR_DARK_GREEN = (0, 100, 0)
COLOR_LIGHT_GREEN = (144, 238, 144)
COLOR_ORANGE = (0, 165, 255)
COLOR_GRAY = (128, 128, 128)


# ======================================================================
# Trajectory colour ramp
# ======================================================================

def _trajectory_color(progress: float) -> Tuple[int, int, int]:
    """Interpolate from green → amber → red based on *progress* in [0, 1]."""
    if progress < 0.5:
        t = progress / 0.5
        r = int(COLOR_GREEN[0] * (1 - t) + COLOR_AMBER[0] * t)
        g = int(COLOR_GREEN[1] * (1 - t) + COLOR_AMBER[1] * t)
        b = int(COLOR_GREEN[2] * (1 - t) + COLOR_AMBER[2] * t)
    else:
        t = (progress - 0.5) / 0.5
        r = int(COLOR_AMBER[0] * (1 - t) + COLOR_RED[0] * t)
        g = int(COLOR_AMBER[1] * (1 - t) + COLOR_RED[1] * t)
        b = int(COLOR_AMBER[2] * (1 - t) + COLOR_RED[2] * t)
    return (r, g, b)


# ======================================================================
# Public drawing functions
# ======================================================================

def draw_trajectory_path(
    frame: np.ndarray,
    points: List[Tuple[float, float]],
    line_width: int = 2,
    draw_dots: bool = True,
    dot_radius: int = 4,
) -> np.ndarray:
    """Draw the ball trajectory as a colour-ramped path.

    Args:
        frame: BGR image to annotate (modified in-place).
        points: List of ``(x, y)`` pixel coordinates.
        line_width: Thickness of the trajectory line.
        draw_dots: Whether to draw dots at each point.
        dot_radius: Radius of the dots.

    Returns:
        The annotated frame.
    """
    if len(points) < 2:
        return frame

    n = len(points)
    for i in range(1, n):
        progress = i / max(n - 1, 1)
        color = _trajectory_color(progress)
        pt1 = (int(points[i - 1][0]), int(points[i - 1][1]))
        pt2 = (int(points[i][0]), int(points[i][1]))
        cv2.line(frame, pt1, pt2, color, line_width, cv2.LINE_AA)

        if draw_dots:
            cv2.circle(frame, pt2, dot_radius, color, -1, cv2.LINE_AA)

    return frame


def draw_ball_glow(
    frame: np.ndarray,
    x: int,
    y: int,
    radius: int = 8,
    color: Tuple[int, int, int] = COLOR_YELLOW,
) -> np.ndarray:
    """Draw a ball position with a soft glow effect.

    Uses concentric circles with decreasing alpha to simulate glow.
    """
    overlay = frame.copy()
    for r_mult, alpha in [(3.0, 30), (2.0, 60), (1.5, 100), (1.0, 200)]:
        r = int(radius * r_mult)
        cv2.circle(overlay, (x, y), r, color, -1, cv2.LINE_AA)

    # Blend
    cv2.addWeighted(overlay, 0.3, frame, 0.7, 0, frame)

    # Solid centre dot
    cv2.circle(frame, (x, y), radius, color, -1, cv2.LINE_AA)
    cv2.circle(frame, (x, y), radius, COLOR_WHITE, 1, cv2.LINE_AA)
    return frame


def draw_pitch_markings(
    frame: np.ndarray,
    pitch_corners: Optional[List[Tuple[int, int]]] = None,
) -> np.ndarray:
    """Draw a semi-transparent pitch overlay on the frame.

    Args:
        frame: BGR image (modified in-place).
        pitch_corners: Four corners ``[TL, TR, BR, BL]`` in pixel
            coordinates.  If ``None``, a default rectangular region is
            used.
    """
    h, w = frame.shape[:2]

    if pitch_corners and len(pitch_corners) == 4:
        pts = np.array(pitch_corners, dtype=np.int32)
    else:
        # Default: centred pitch rectangle
        margin_x = int(w * 0.2)
        margin_y = int(h * 0.05)
        pts = np.array([
            [margin_x, margin_y],
            [w - margin_x, margin_y],
            [w - margin_x, h - margin_y],
            [margin_x, h - margin_y],
        ], dtype=np.int32)

    overlay = frame.copy()
    cv2.fillPoly(overlay, [pts], (0, 80, 0, 60))
    cv2.addWeighted(overlay, 0.15, frame, 0.85, 0, frame)

    # Draw crease lines
    cv2.polylines(frame, [pts], isClosed=True, color=COLOR_WHITE, thickness=2)

    # Draw centre line (batting crease at ~75 % of pitch height)
    crease_y = pts[0][1] + int((pts[3][1] - pts[0][1]) * 0.75)
    cv2.line(frame, (pts[3][0], crease_y), (pts[2][0], crease_y),
             COLOR_WHITE, 2, cv2.LINE_AA)

    # Bowling crease at ~10 %
    crease_y_bowl = pts[0][1] + int((pts[3][1] - pts[0][1]) * 0.10)
    cv2.line(frame, (pts[3][0], crease_y_bowl), (pts[2][0], crease_y_bowl),
             COLOR_WHITE, 2, cv2.LINE_AA)

    return frame


def draw_stumps(
    frame: np.ndarray,
    x: int,
    y: int,
    stumps_width: int = 20,
    stumps_height: int = 60,
    color: Tuple[int, int, int] = COLOR_ORANGE,
) -> np.ndarray:
    """Draw three stumps at the given base position.

    Args:
        frame: BGR image (modified in-place).
        x: Centre x of the stumps.
        y: Base y (bottom of stumps).
        stumps_width: Total width across 3 stumps.
        stumps_height: Height of each stump in pixels.
        color: BGR colour for the stumps.
    """
    spacing = stumps_width // 3
    for offset in [-spacing, 0, spacing]:
        sx = x + offset
        cv2.line(frame, (sx, y), (sx, y - stumps_height), color, 2, cv2.LINE_AA)

    # Bails
    cv2.line(frame, (x - spacing, y - stumps_height),
             (x + spacing, y - stumps_height), color, 2, cv2.LINE_AA)

    return frame


def draw_label(
    frame: np.ndarray,
    text: str,
    x: int,
    y: int,
    color: Tuple[int, int, int] = COLOR_WHITE,
    bg_color: Tuple[int, int, int] = COLOR_BLACK,
    font_scale: float = 0.6,
    thickness: int = 1,
    padding: int = 4,
) -> np.ndarray:
    """Draw a text label with a semi-transparent background rectangle.

    Args:
        frame: BGR image (modified in-place).
        text: Label string.
        x: Top-left x.
        y: Top-left y.
        color: Text colour (BGR).
        bg_color: Background colour (BGR).
        font_scale: ``cv2.FONT_HERSHEY_SIMPLEX`` scale.
        thickness: Text thickness.
        padding: Padding around text in pixels.
    """
    font = cv2.FONT_HERSHEY_SIMPLEX
    (tw, th), baseline = cv2.getTextSize(text, font, font_scale, thickness)

    # Background rectangle
    bg_rect = (x - padding, y - padding - th,
               tw + 2 * padding, th + baseline + 2 * padding)

    overlay = frame.copy()
    cv2.rectangle(overlay, bg_rect[:2],
                  (bg_rect[0] + bg_rect[2], bg_rect[1] + bg_rect[3]),
                  bg_color, -1)
    cv2.addWeighted(overlay, 0.6, frame, 0.4, 0, frame)

    # Text
    cv2.putText(frame, text, (x, y), font, font_scale, color, thickness, cv2.LINE_AA)
    return frame


def draw_decision_overlay(
    frame: np.ndarray,
    decision: str,
    dismissal_type: str,
    confidence: float,
    ball_speed_kmh: float,
) -> np.ndarray:
    """Draw the final decision as a large banner at the top of the frame.

    Args:
        frame: BGR image (modified in-place).
        decision: ``"OUT"`` or ``"NOT OUT"``.
        dismissal_type: e.g. ``"LBW"``, ``"BOWLED"``.
        confidence: Score in [0, 1].
        ball_speed_kmh: Estimated speed.
    """
    h, w = frame.shape[:2]

    # Banner background
    banner_h = 80
    overlay = frame.copy()
    banner_color = COLOR_RED if decision == "OUT" else COLOR_DARK_GREEN
    cv2.rectangle(overlay, (0, 0), (w, banner_h), banner_color, -1)
    cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)

    # Decision text
    text = f"{decision}"
    if dismissal_type not in ("NOT_OUT", "NOT OUT"):
        text += f" — {dismissal_type}"
    font = cv2.FONT_HERSHEY_SIMPLEX
    (tw, th), _ = cv2.getTextSize(text, font, 1.2, 3)
    cv2.putText(frame, text, ((w - tw) // 2, 35), font, 1.2, COLOR_WHITE, 3, cv2.LINE_AA)

    # Subtitle
    sub = f"Confidence: {confidence:.0%}  |  Speed: {ball_speed_kmh:.0f} km/h  |  UMPIRE AI"
    (sw, sh), _ = cv2.getTextSize(sub, font, 0.5, 1)
    cv2.putText(frame, sub, ((w - sw) // 2, 65), font, 0.5, COLOR_CYAN, 1, cv2.LINE_AA)

    return frame


def draw_prediction_zone(
    frame: np.ndarray,
    points: List[Tuple[float, float]],
    color: Tuple[int, int, int] = (0, 0, 200),
    alpha: float = 0.2,
) -> np.ndarray:
    """Draw a semi-transparent convex hull around trajectory points.

    Used to visualise the predicted path zone.
    """
    if len(points) < 3:
        return frame

    pts = np.array([(int(p[0]), int(p[1])) for p in points], dtype=np.int32)
    hull = cv2.convexHull(pts)

    overlay = frame.copy()
    cv2.fillPoly(overlay, [hull], color)
    cv2.addWeighted(overlay, alpha, frame, 1.0 - alpha, 0, frame)

    cv2.polylines(frame, [hull], isClosed=True, color=COLOR_WHITE, thickness=1)
    return frame


def draw_frame_info(
    frame: np.ndarray,
    frame_number: int,
    timestamp: float,
    fps: float = 30.0,
) -> np.ndarray:
    """Draw a small info strip at the bottom-left of the frame."""
    text = f"Frame: {frame_number}  |  Time: {timestamp:.2f}s  |  FPS: {fps:.0f}"
    return draw_label(
        frame, text, 10, frame.shape[0] - 10,
        color=COLOR_WHITE, bg_color=(40, 40, 40),
        font_scale=0.45, thickness=1,
    )


def draw_detection_box(
    frame: np.ndarray,
    x: int,
    y: int,
    radius: int,
    confidence: float,
    label: str = "BALL",
) -> np.ndarray:
    """Draw a bounding circle with a confidence label around a detection."""
    cv2.circle(frame, (x, y), radius + 4, COLOR_CYAN, 2, cv2.LINE_AA)
    text = f"{label} {confidence:.0%}"
    return draw_label(
        frame, text, x + radius + 6, y - 5,
        color=COLOR_CYAN, bg_color=(30, 30, 30),
        font_scale=0.4, thickness=1,
    )
