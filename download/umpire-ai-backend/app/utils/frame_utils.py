"""
Frame extraction and encoding utilities.

Provides helpers for extracting frames from video, resizing them for
processing, computing timestamps, and encoding frames as JPEG bytes
suitable for base64 transport.
"""

import cv2
import numpy as np
from typing import Optional, Tuple, Generator


def extract_frames(
    video_path: str,
    target_fps: Optional[int] = None,
    frame_skip: int = 1,
    max_width: Optional[int] = None,
    max_height: Optional[int] = None,
) -> Generator[Tuple[np.ndarray, int, float], None, None]:
    """Yield frames from a video file.

    Args:
        video_path: Path to the video file.
        target_fps: If set, skip frames to approximate this framerate.
        frame_skip: Yield every Nth frame (1 = every frame).
        max_width: Resize frame to this width (maintaining aspect ratio).
        max_height: Resize frame to this height.

    Yields:
        ``(frame, frame_number, timestamp)`` tuples where *frame* is a
        BGR numpy array.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise IOError(f"Cannot open video: {video_path}")

    video_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    skip_interval = max(1, int(video_fps / target_fps)) if target_fps else frame_skip

    frame_number = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break

        timestamp = frame_number / video_fps

        if frame_number % skip_interval == 0:
            if max_width or max_height:
                frame = resize_frame(frame, max_width, max_height)
            yield frame, frame_number, round(timestamp, 4)

        frame_number += 1

    cap.release()


def resize_frame(
    frame: np.ndarray,
    max_width: Optional[int] = None,
    max_height: Optional[int] = None,
) -> np.ndarray:
    """Resize *frame* to fit within *max_width* × *max_height* while
    preserving aspect ratio.

    If both are ``None`` the frame is returned unchanged.
    """
    if max_width is None and max_height is None:
        return frame

    h, w = frame.shape[:2]
    scale = 1.0

    if max_width and w > max_width:
        scale = min(scale, max_width / w)
    if max_height and h > max_height:
        scale = min(scale, max_height / h)

    if scale < 1.0:
        new_w = int(w * scale)
        new_h = int(h * scale)
        frame = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA)

    return frame


def encode_frame_jpeg(
    frame: np.ndarray,
    quality: int = 85,
) -> bytes:
    """Encode a BGR frame as JPEG bytes.

    Args:
        frame: BGR numpy array.
        quality: JPEG compression quality (0–100).

    Returns:
        JPEG-encoded bytes.
    """
    success, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not success:
        raise RuntimeError("Failed to encode frame as JPEG")
    return encoded.tobytes()


def get_video_info(video_path: str) -> dict:
    """Read metadata from a video file without decoding frames.

    Returns:
        Dictionary with keys: ``width``, ``height``, ``fps``,
        ``frame_count``, ``duration``.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise IOError(f"Cannot open video: {video_path}")

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = frame_count / fps if fps > 0 else 0.0

    cap.release()

    return {
        "width": width,
        "height": height,
        "fps": round(fps, 2),
        "frame_count": frame_count,
        "duration": round(duration, 2),
    }
