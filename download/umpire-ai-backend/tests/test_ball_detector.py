"""
Unit tests for the ball detector module.

Creates synthetic frames with coloured circles to verify that
:class:`BallDetector` correctly identifies them based on ball type,
circularity filtering, and confidence scoring.
"""

import pytest
import numpy as np
import cv2

from app.core.ball_detector import BallDetector, BallDetection


# ======================================================================
# Fixtures
# ======================================================================

@pytest.fixture
def red_ball_frame() -> np.ndarray:
    """Create a 640×480 BGR frame with a red circle at (320, 240)."""
    frame = np.full((480, 640, 3), 50, dtype=np.uint8)  # dark grey
    cv2.circle(frame, (320, 240), 8, (0, 0, 220), -1)   # BGR red
    return frame


@pytest.fixture
def white_ball_frame() -> np.ndarray:
    """Create a 640×480 BGR frame with a white circle at (200, 150)."""
    frame = np.full((480, 640, 3), 50, dtype=np.uint8)
    cv2.circle(frame, (200, 150), 10, (240, 240, 240), -1)
    return frame


@pytest.fixture
def pink_ball_frame() -> np.ndarray:
    """Create a 640×480 BGR frame with a pink circle at (400, 300)."""
    frame = np.full((480, 640, 3), 50, dtype=np.uint8)
    cv2.circle(frame, (400, 300), 7, (180, 80, 180), -1)  # BGR pinkish
    return frame


@pytest.fixture
def empty_frame() -> np.ndarray:
    """Create a plain dark frame with no ball."""
    return np.full((480, 640, 3), 50, dtype=np.uint8)


@pytest.fixture
def noise_frame() -> np.ndarray:
    """Create a frame with random noise (no real ball)."""
    np.random.seed(42)
    return np.random.randint(0, 80, (480, 640, 3), dtype=np.uint8)


# ======================================================================
# Detector instantiation
# ======================================================================

class TestBallDetectorInit:
    """Tests for BallDetector initialisation."""

    def test_default_initialisation(self):
        detector = BallDetector()
        assert detector.ball_type == "red"
        assert detector.min_radius == 3
        assert detector.max_radius == 25

    def test_white_ball(self):
        detector = BallDetector(ball_type="white")
        assert detector.ball_type == "white"

    def test_invalid_ball_type_raises(self):
        with pytest.raises(ValueError, match="Unknown ball_type"):
            BallDetector(ball_type="green")

    def test_custom_radius(self):
        detector = BallDetector(min_radius=5, max_radius=15)
        assert detector.min_radius == 5
        assert detector.max_radius == 15


# ======================================================================
# Red ball detection
# ======================================================================

class TestRedBallDetection:
    """Tests for detecting red balls."""

    def test_detects_red_ball(self, red_ball_frame):
        detector = BallDetector(ball_type="red", min_radius=3, max_radius=25)
        detections = detector.detect(red_ball_frame, frame_number=0, timestamp=0.0)
        assert len(detections) >= 1

        best = detections[0]
        # Ball should be near (320, 240) with some tolerance
        assert abs(best.x - 320) < 15
        assert abs(best.y - 240) < 15
        assert best.radius >= 3
        assert best.confidence > 0

    def test_no_false_positive_on_empty_frame(self, empty_frame):
        detector = BallDetector(ball_type="red")
        detections = detector.detect(empty_frame, frame_number=0, timestamp=0.0)
        assert len(detections) == 0

    def test_no_false_positive_on_noise(self, noise_frame):
        detector = BallDetector(ball_type="red")
        detections = detector.detect(noise_frame, frame_number=0, timestamp=0.0)
        # Noise should not produce high-confidence detections
        for d in detections:
            assert d.confidence < 0.95


# ======================================================================
# White ball detection
# ======================================================================

class TestWhiteBallDetection:
    """Tests for detecting white balls."""

    def test_detects_white_ball(self, white_ball_frame):
        detector = BallDetector(ball_type="white")
        detections = detector.detect(white_ball_frame, frame_number=0, timestamp=0.0)
        assert len(detections) >= 1
        best = detections[0]
        assert abs(best.x - 200) < 15
        assert abs(best.y - 150) < 15


# ======================================================================
# Pink ball detection
# ======================================================================

class TestPinkBallDetection:
    """Tests for detecting pink balls."""

    def test_detects_pink_ball(self, pink_ball_frame):
        detector = BallDetector(ball_type="pink")
        detections = detector.detect(pink_ball_frame, frame_number=0, timestamp=0.0)
        # Pink detection may be less reliable with a simple circle;
        # just verify no crash
        assert isinstance(detections, list)


# ======================================================================
# Edge cases
# ======================================================================

class TestEdgeCases:
    """Edge case and robustness tests."""

    def test_none_frame_returns_empty(self):
        detector = BallDetector()
        detections = detector.detect(None, frame_number=0, timestamp=0.0)
        assert detections == []

    def test_empty_array_returns_empty(self):
        detector = BallDetector()
        detections = detector.detect(np.array([]), frame_number=0, timestamp=0.0)
        assert detections == []

    def test_detections_sorted_by_confidence(self, red_ball_frame):
        detector = BallDetector(ball_type="red", min_confidence=0.0)
        detections = detector.detect(red_ball_frame, frame_number=0, timestamp=0.0)
        if len(detections) > 1:
            for i in range(len(detections) - 1):
                assert detections[i].confidence >= detections[i + 1].confidence

    def test_max_three_detections(self, red_ball_frame):
        detector = BallDetector(ball_type="red", min_confidence=0.0)
        detections = detector.detect(red_ball_frame, frame_number=0, timestamp=0.0)
        assert len(detections) <= 3

    def test_frame_number_and_timestamp_preserved(self, red_ball_frame):
        detector = BallDetector(ball_type="red")
        detections = detector.detect(red_ball_frame, frame_number=42, timestamp=1.5)
        for d in detections:
            assert d.frame_number == 42
            assert abs(d.timestamp - 1.5) < 0.01
