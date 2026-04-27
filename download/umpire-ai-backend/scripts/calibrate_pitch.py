#!/usr/bin/env python3
"""
Interactive pitch calibration tool.

Opens the first frame of a video and lets the user click four corners
of the visible pitch to define the perspective transform.  The
calibration is saved as a JSON file that can be supplied to the
analysis API.

Usage::

    python scripts/calibrate_pitch.py path/to/video.mp4

Click order:
    1. Top-left corner of the pitch
    2. Top-right corner of the pitch
    3. Bottom-right corner of the pitch
    4. Bottom-left corner of the pitch

Press any key after each click.  Press ``q`` to quit.
"""

import sys
import json
import uuid
from pathlib import Path

import cv2
import numpy as np


def main() -> None:
    """Run the interactive calibration tool."""
    if len(sys.argv) < 2:
        print("Usage: python calibrate_pitch.py <video_path>")
        sys.exit(1)

    video_path = sys.argv[1]
    if not Path(video_path).exists():
        print(f"Error: file not found: {video_path}")
        sys.exit(1)

    # Read first frame
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"Error: cannot open video: {video_path}")
        sys.exit(1)

    ret, frame = cap.read()
    cap.release()

    if not ret:
        print("Error: cannot read first frame")
        sys.exit(1)

    h, w = frame.shape[:2]
    display = frame.copy()

    # Instructions overlay
    cv2.putText(
        display,
        "Click 4 pitch corners in order: TL, TR, BR, BL",
        (20, 30),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (0, 255, 255),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        display,
        "Press 'q' to quit | Press 'r' to reset",
        (20, h - 20),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5,
        (200, 200, 200),
        1,
        cv2.LINE_AA,
    )

    points: list = []
    labels = ["TOP-LEFT", "TOP-RIGHT", "BOTTOM-RIGHT", "BOTTOM-LEFT"]
    colors = [
        (0, 255, 0),    # green
        (255, 255, 0),  # cyan
        (0, 0, 255),    # red
        (255, 0, 255),  # magenta
    ]

    def mouse_callback(event, x, y, flags, param):
        """Handle mouse clicks."""
        nonlocal display

        if event == cv2.EVENT_LBUTTONDOWN and len(points) < 4:
            points.append((x, y))
            idx = len(points) - 1

            # Redraw
            display = frame.copy()

            # Draw all placed points
            for i, (px, py) in enumerate(points):
                cv2.circle(display, (px, py), 6, colors[i], -1, cv2.LINE_AA)
                cv2.putText(
                    display, labels[i], (px + 10, py - 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, colors[i], 1, cv2.LINE_AA,
                )

            # Draw lines between consecutive points
            if len(points) >= 2:
                for i in range(len(points) - 1):
                    cv2.line(display, points[i], points[i + 1],
                             (200, 200, 200), 1, cv2.LINE_AA)

            # Prompt for next point
            if len(points) < 4:
                cv2.putText(
                    display,
                    f"Click {labels[len(points)]} ({len(points)}/4)",
                    (20, 30),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (0, 255, 255),
                    2,
                    cv2.LINE_AA,
                )

    window_name = "Pitch Calibration"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
    cv2.setMouseCallback(window_name, mouse_callback)

    print("Pitch Calibration Tool")
    print("=" * 40)
    print("Click the four corners of the pitch in order:")
    print("  1. Top-Left    2. Top-Right")
    print("  3. Bottom-Right  4. Bottom-Left")
    print()
    print("Press 'q' to quit, 'r' to reset, 's' to save (after 4 points)")

    while True:
        cv2.imshow(window_name, display)
        key = cv2.waitKey(30) & 0xFF

        if key == ord("q"):
            print("Quit without saving.")
            break

        if key == ord("r"):
            points.clear()
            display = frame.copy()
            cv2.putText(
                display,
                "Click 4 pitch corners: TL, TR, BR, BL",
                (20, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 255),
                2,
                cv2.LINE_AA,
            )
            print("Reset. Click 4 corners again.")

        if key == ord("s") and len(points) == 4:
            calibration = {
                "top_left": list(points[0]),
                "top_right": list(points[1]),
                "bottom_right": list(points[2]),
                "bottom_left": list(points[3]),
            }

            video_id = uuid.uuid4().hex[:8]
            output_dir = Path("./output")
            output_dir.mkdir(parents=True, exist_ok=True)
            output_path = output_dir / f"calibration_{video_id}.json"

            with open(output_path, "w") as f:
                json.dump(calibration, f, indent=2)

            print(f"\nCalibration saved to: {output_path}")
            print(json.dumps(calibration, indent=2))

            # Draw final result with pitch outline
            display = frame.copy()
            pts = np.array(points, dtype=np.int32)
            cv2.polylines(display, [pts], True, (0, 255, 0), 2, cv2.LINE_AA)
            for i, (px, py) in enumerate(points):
                cv2.circle(display, (px, py), 8, colors[i], -1, cv2.LINE_AA)

            cv2.putText(
                display,
                "Calibration saved! Press 'q' to exit.",
                (20, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 255, 0),
                2,
                cv2.LINE_AA,
            )

            # Also draw the perspective-transformed view
            src = np.array(points, dtype=np.float32)
            dst = np.array([
                [0, 0], [300, 0], [300, 1000], [0, 1000]
            ], dtype=np.float32)
            M = cv2.getPerspectiveTransform(src, dst)
            warped = cv2.warpPerspective(frame, M, (300, 1000))

            cv2.imshow("Top-Down View", warped)

    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
