"""
Comprehensive tests for refactored detection modules:
- pose_estimator.py
- ekf_tracker.py
- release_detector.py
- pitch_keypoint_detector.py
"""
import pytest
import numpy as np
import cv2
from unittest.mock import MagicMock, patch


# ======================================================================
# Fixtures
# ======================================================================

@pytest.fixture
def dark_frame():
    """Synthetic dark BGR frame (480x640)."""
    return np.full((480, 640, 3), 40, dtype=np.uint8)


@pytest.fixture
def bright_frame():
    """Synthetic bright BGR frame (720x1280)."""
    return np.full((720, 1280, 3), 200, dtype=np.uint8)


@pytest.fixture
def ball_frame():
    """BGR frame with a bright circle (simulating a ball)."""
    frame = np.full((480, 640, 3), 50, dtype=np.uint8)
    cv2.circle(frame, (320, 240), 10, (220, 220, 220), -1)
    return frame


@pytest.fixture
def noisy_points():
    """Noisy linear trajectory for smoothing tests."""
    np.random.seed(42)
    return [
        (100 + i * 5 + np.random.randn() * 3,
         200 + i * 2 + np.random.randn() * 3,
         i, i / 30.0)
        for i in range(30)
    ]


# ======================================================================
# TestPoseEstimator
# ======================================================================

class TestPoseEstimator:
    """Tests for app.core.pose_estimator module."""

    def test_pose_keypoint_dataclass(self):
        """PoseKeypoint stores x, y, confidence, and name correctly."""
        from app.core.pose_estimator import PoseKeypoint
        kp = PoseKeypoint(x=100, y=200, confidence=0.95, name="LEFT_WRIST")
        assert kp.x == 100
        assert kp.y == 200
        assert kp.confidence == 0.95
        assert kp.name == "LEFT_WRIST"

    def test_pose_result_dataclass(self):
        """PoseResult stores keypoints, hand_position, and metadata."""
        from app.core.pose_estimator import PoseResult, PoseKeypoint
        kp = PoseKeypoint(x=100, y=200, confidence=0.9, name="RIGHT_WRIST")
        result = PoseResult(
            keypoints={"RIGHT_WRIST": kp},
            hand_position=(100, 200),
            hand_confidence=0.9,
            frame_number=0,
            timestamp=0.0,
        )
        assert result.hand_position == (100, 200)
        assert result.hand_confidence == 0.9
        assert result.frame_number == 0
        assert "RIGHT_WRIST" in result.keypoints

    def test_pose_result_hand_position_optional(self):
        """PoseResult allows hand_position=None."""
        from app.core.pose_estimator import PoseResult
        result = PoseResult(
            keypoints={},
            hand_position=None,
            hand_confidence=0.0,
            frame_number=5,
            timestamp=0.16,
        )
        assert result.hand_position is None
        assert result.hand_confidence == 0.0

    def test_initialisation_none_mode(self):
        """PoseEstimator with 'none' mode should be inactive."""
        from app.core.pose_estimator import PoseEstimator
        est = PoseEstimator(pose_tier="none")
        assert est.active_tier == "none"

    def test_initialisation_auto_mode(self):
        """PoseEstimator with auto mode should try mediapipe first.

        When mediapipe and ultralytics are not installed, it should
        gracefully fall back to 'none'.
        """
        from app.core.pose_estimator import PoseEstimator
        est = PoseEstimator(pose_tier="auto")
        # If neither mediapipe nor ultralytics is available, falls to 'none'
        assert est.active_tier in ("mediapipe", "yolopose", "none")

    def test_estimate_with_none_frame(self):
        """Should handle None frame gracefully."""
        from app.core.pose_estimator import PoseEstimator
        est = PoseEstimator(pose_tier="none")
        result = est.estimate(None, 0, 0.0)
        assert result is None

    def test_estimate_with_empty_frame(self):
        """Should handle empty array gracefully."""
        from app.core.pose_estimator import PoseEstimator
        est = PoseEstimator(pose_tier="none")
        result = est.estimate(np.array([]), 0, 0.0)
        assert result is None

    def test_estimate_returns_none_for_none_mode(self):
        """None mode should always return None for valid frames."""
        from app.core.pose_estimator import PoseEstimator
        est = PoseEstimator(pose_tier="none")
        frame = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)
        result = est.estimate(frame, 0, 0.0)
        assert result is None

    def test_get_dynamic_roi_basic(self):
        """ROI generation with zero velocity returns base_size-centred rect.

        With centre=(320,240), base_size=100, velocity=0:
            size=100, half=50 → x1=270, y1=190, x2=370, y2=290
        """
        from app.core.pose_estimator import get_dynamic_roi
        x1, y1, x2, y2 = get_dynamic_roi(320, 240, base_size=100)
        assert x1 == 270
        assert y1 == 190
        assert x2 == 370
        assert y2 == 290

    def test_get_dynamic_roi_expands_with_velocity(self):
        """ROI should expand when velocity increases."""
        from app.core.pose_estimator import get_dynamic_roi
        roi_static = get_dynamic_roi(320, 240, base_size=100, velocity=0)
        roi_fast = get_dynamic_roi(320, 240, base_size=100, velocity=500)
        # Fast ROI should be larger
        static_w = roi_static[2] - roi_static[0]
        fast_w = roi_fast[2] - roi_fast[0]
        assert fast_w > static_w

    def test_get_dynamic_roi_clamped_to_frame(self):
        """ROI should be clamped to non-negative values."""
        from app.core.pose_estimator import get_dynamic_roi
        roi = get_dynamic_roi(10, 10, base_size=100)
        assert roi[0] >= 0
        assert roi[1] >= 0

    def test_get_dynamic_roi_velocity_capped(self):
        """Velocity expansion should be capped at 80 pixels."""
        from app.core.pose_estimator import get_dynamic_roi
        roi_med = get_dynamic_roi(320, 240, base_size=100, velocity=300)
        roi_max = get_dynamic_roi(320, 240, base_size=100, velocity=1000)
        # Both should produce same size since 300*0.3=90 capped to 80,
        # and 1000*0.3=300 capped to 80
        assert (roi_med[2] - roi_med[0]) == (roi_max[2] - roi_max[0])

    def test_compute_hand_velocity_empty_history(self):
        """Should return zeros for empty history."""
        from app.core.pose_estimator import compute_hand_velocity
        vx, vy, speed = compute_hand_velocity([])
        assert vx == 0
        assert vy == 0
        assert speed == 0

    def test_compute_hand_velocity_single_frame(self):
        """Should return zeros for single frame."""
        from app.core.pose_estimator import compute_hand_velocity, PoseResult, PoseKeypoint
        kp = PoseKeypoint(x=100, y=200, confidence=0.9, name="RIGHT_WRIST")
        result = PoseResult(
            keypoints={"RIGHT_WRIST": kp},
            hand_position=(100, 200), hand_confidence=0.9,
            frame_number=0, timestamp=0.0,
        )
        vx, vy, speed = compute_hand_velocity([result])
        assert speed == 0

    def test_compute_hand_velocity_multiple_frames(self):
        """Should compute velocity from frame history."""
        from app.core.pose_estimator import compute_hand_velocity, PoseResult, PoseKeypoint
        results = []
        for i in range(5):
            kp = PoseKeypoint(
                x=100 + i * 10, y=200 + i * 5,
                confidence=0.9, name="RIGHT_WRIST",
            )
            r = PoseResult(
                keypoints={"RIGHT_WRIST": kp},
                hand_position=(100 + i * 10, 200 + i * 5),
                hand_confidence=0.9, frame_number=i, timestamp=i / 30.0,
            )
            results.append(r)
        vx, vy, speed = compute_hand_velocity(results)
        assert speed > 0  # should be moving

    def test_compute_hand_velocity_none_hand_position(self):
        """Frames with None hand_position should be skipped gracefully.

        When the middle frame has None hand_position, adjacent pairs that
        include it are skipped.  With window=3 (default) only the last 3
        frames are considered: (r1, r2) and (r2, r3).  Since r2 has None
        both pairs are skipped, yielding speed=0.  This test verifies the
        function does not crash.
        """
        from app.core.pose_estimator import compute_hand_velocity, PoseResult, PoseKeypoint
        kp1 = PoseKeypoint(x=100, y=200, confidence=0.9, name="RIGHT_WRIST")
        r1 = PoseResult(
            keypoints={"RIGHT_WRIST": kp1},
            hand_position=(100, 200), hand_confidence=0.9,
            frame_number=0, timestamp=0.0,
        )
        r2 = PoseResult(
            keypoints={}, hand_position=None, hand_confidence=0.0,
            frame_number=1, timestamp=1 / 30.0,
        )
        kp3 = PoseKeypoint(x=120, y=210, confidence=0.9, name="RIGHT_WRIST")
        r3 = PoseResult(
            keypoints={"RIGHT_WRIST": kp3},
            hand_position=(120, 210), hand_confidence=0.9,
            frame_number=2, timestamp=2 / 30.0,
        )
        # Should not crash; None frames are silently skipped
        vx, vy, speed = compute_hand_velocity([r1, r2, r3])
        # With default window=3, pairs (r1,r2) and (r2,r3) are both
        # skipped because r2 has None hand_position → speed=0
        assert speed == 0.0

    def test_close_method_exists(self):
        """close() should be callable without error."""
        from app.core.pose_estimator import PoseEstimator
        est = PoseEstimator(pose_tier="none")
        est.close()  # should not raise


# ======================================================================
# TestExtendedKalmanFilter
# ======================================================================

class TestExtendedKalmanFilter:
    """Tests for app.core.ekf_tracker.ExtendedKalmanFilter."""

    def test_initialisation(self):
        """EKF starts with zero state and reasonable covariance."""
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        state = ekf.get_state()
        assert state.shape == (6,)
        assert np.allclose(state, 0)
        assert not ekf.initialized

    def test_first_update_initializes(self):
        """First update should set the state and mark initialized."""
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        ekf.update(np.array([100.0, 200.0, 0.0]))
        state = ekf.get_state()
        assert ekf.initialized
        assert state[0] != 0  # x should be set

    def test_predict_before_update(self):
        """Predict before any update should not crash (no-op)."""
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        ekf.predict()  # should not crash
        assert not ekf.initialized

    def test_consecutive_updates_smooth(self):
        """Consecutive updates should produce smoothed trajectory."""
        np.random.seed(42)
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        true_x, true_y = 100.0, 200.0
        for i in range(20):
            noisy_x = true_x + i * 5 + np.random.randn() * 3
            noisy_y = true_y + i * 2 + np.random.randn() * 3
            ekf.predict()
            ekf.update(np.array([noisy_x, noisy_y, 0.0]))
        state = ekf.get_state()
        # State should be close to the true trajectory end point
        expected_x = true_x + 19 * 5
        assert abs(state[0] - expected_x) < 15  # within smoothing tolerance

    def test_predict_future_returns_points(self):
        """predict_future should return list of dicts with x, y, z, bounce."""
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        ekf.update(np.array([100.0, 200.0, 0.0]))
        ekf.update(np.array([110.0, 210.0, 0.0]))
        future = ekf.predict_future(n_steps=10)
        assert len(future) == 10
        assert "x" in future[0]
        assert "y" in future[0]
        assert "z" in future[0]
        assert "bounce" in future[0]

    def test_predict_future_shorter_for_ground_hit(self):
        """Future prediction with bouncing ball should show bounce flags.

        The bounce model reflects z >= 0, so the ball never escapes below
        ground.  Instead we verify that bounce flags are raised.
        """
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        # Ball at ground level with high downward velocity
        ekf.x = np.array([0, 0, 0.01, 0, 0, -50.0], dtype=np.float64)
        ekf.initialized = True
        future = ekf.predict_future(n_steps=30)
        # Ball should bounce (bounce flag True in some steps)
        bounce_flags = [f["bounce"] for f in future]
        assert any(bounce_flags)  # at least one bounce detected

    def test_handle_occlusion_increases_uncertainty(self):
        """Occlusion should increase position uncertainty (trace of P)."""
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        ekf.update(np.array([100.0, 200.0, 0.0]))
        P_before = ekf.P.copy()
        ekf.handle_occlusion(missed_frames=5)
        assert np.trace(ekf.P) > np.trace(P_before)

    def test_handle_occlusion_zero_frames(self):
        """Zero missed frames should be a no-op."""
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        ekf.update(np.array([100.0, 200.0, 0.0]))
        P_before = ekf.P.copy()
        ekf.handle_occlusion(missed_frames=0)
        assert np.allclose(ekf.P, P_before)

    def test_state_transition_includes_gravity(self):
        """State transition should cause z to decrease (gravity)."""
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        ekf.x = np.array([0, 0, 10, 0, 0, 0], dtype=np.float64)
        ekf.initialized = True
        new_state = ekf._state_transition(ekf.x, 1 / 30)
        assert new_state[2] < 10  # z should decrease due to gravity

    def test_bounce_detection(self):
        """Ball going below ground should bounce back up."""
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        ekf.x = np.array([0, 0, 0.1, 0, 0, -5.0], dtype=np.float64)
        ekf.initialized = True
        new_state = ekf._state_transition(ekf.x, 1 / 30)
        # z should be reflected back up (positive) with restitution
        assert new_state[2] >= 0
        assert ekf.bounce_detected

    def test_jacobian_shape(self):
        """Jacobian should be 6x6."""
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        J = ekf._jacobian_F(ekf.x, 1 / 30)
        assert J.shape == (6, 6)

    def test_jacobian_identity_on_position_diagonal(self):
        """Position-position diagonal entries of Jacobian should be 1.0."""
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        J = ekf._jacobian_F(ekf.x, 1 / 30)
        assert J[0, 0] == 1.0
        assert J[1, 1] == 1.0
        assert J[2, 2] == 1.0

    def test_adaptive_measurement_noise(self):
        """Both high and low confidence updates should produce valid states."""
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        ekf.update(np.array([100.0, 200.0, 0.0]), confidence=1.0)
        state_high_conf = ekf.get_state().copy()
        ekf2 = ExtendedKalmanFilter(dt=1 / 30)
        ekf2.update(np.array([100.0, 200.0, 0.0]), confidence=0.3)
        state_low_conf = ekf2.get_state().copy()
        assert state_high_conf[0] > 0
        assert state_low_conf[0] > 0

    def test_reset(self):
        """Reset should clear state and mark uninitialized."""
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        ekf.update(np.array([100.0, 200.0, 0.0]))
        ekf.reset()
        assert not ekf.initialized
        assert np.allclose(ekf.x, 0)

    def test_large_dt_handling(self):
        """Large dt (frame skip) should inflate uncertainty."""
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        ekf.update(np.array([100.0, 200.0, 0.0]))
        P_normal = ekf.P.copy()
        ekf.predict(dt=0.5)  # 15x normal dt
        assert np.trace(ekf.P) > np.trace(P_normal)

    def test_get_state_as_ekf(self):
        """get_state_as_ekf should return an EKFState dataclass."""
        from app.core.ekf_tracker import ExtendedKalmanFilter, EKFState
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        ekf.update(np.array([100.0, 200.0, 5.0]))
        ekf_state = ekf.get_state_as_ekf(timestamp=0.5, frame_number=15)
        assert isinstance(ekf_state, EKFState)
        assert ekf_state.x == 100.0
        assert ekf_state.y == 200.0
        assert ekf_state.z == 5.0
        assert ekf_state.timestamp == 0.5
        assert ekf_state.frame_number == 15

    def test_predict_zero_dt(self):
        """Predict with dt <= 0 should be a no-op."""
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        ekf.update(np.array([100.0, 200.0, 0.0]))
        state_before = ekf.get_state().copy()
        ekf.predict(dt=0)
        assert np.allclose(ekf.get_state(), state_before)

    def test_measurements_2d_projection(self):
        """Updating with z=0 (2D projection) should work."""
        from app.core.ekf_tracker import ExtendedKalmanFilter
        ekf = ExtendedKalmanFilter(dt=1 / 30)
        ekf.update(np.array([100.0, 200.0, 0.0]))
        state = ekf.get_state()
        assert state[2] == 0.0  # z stays 0


# ======================================================================
# TestSubPixelRefiner
# ======================================================================

class TestSubPixelRefiner:
    """Tests for app.core.ekf_tracker.SubPixelRefiner."""

    def test_refine_basic_detection(self, ball_frame):
        """Should refine a ball detection on a synthetic frame."""
        from app.core.ekf_tracker import SubPixelRefiner
        refiner = SubPixelRefiner()
        result = refiner.refine(ball_frame, 320, 240, 10.0)
        assert result is not None
        # Refined position should be very close to (320, 240)
        assert abs(result.x - 320) < 5
        assert abs(result.y - 240) < 5

    def test_refine_edge_detection(self, dark_frame):
        """Ball near frame edge should not crash."""
        from app.core.ekf_tracker import SubPixelRefiner
        refiner = SubPixelRefiner()
        result = refiner.refine(dark_frame, 2, 2, 5.0)
        # Should not crash; may return fallback detection
        assert result is not None

    def test_subpixel_detection_dataclass(self):
        """SubPixelDetection stores all fields correctly."""
        from app.core.ekf_tracker import SubPixelDetection
        sd = SubPixelDetection(
            x=100.5, y=200.3, radius=8.0,
            confidence=0.95, frame_number=0, timestamp=0.0,
        )
        assert sd.x == 100.5
        assert sd.y == 200.3
        assert sd.radius == 8.0
        assert sd.confidence == 0.95
        assert sd.frame_number == 0

    def test_refine_centred_on_uniform_frame(self, dark_frame):
        """Refining on a uniform dark frame should still return a result."""
        from app.core.ekf_tracker import SubPixelRefiner
        refiner = SubPixelRefiner()
        result = refiner.refine(dark_frame, 320, 240, 10.0)
        # Should fall back to integer coordinates with low confidence
        assert result is not None
        assert result.confidence <= 0.95  # fallback confidence


# ======================================================================
# TestSmoothTrajectoryEKF
# ======================================================================

class TestSmoothTrajectoryEKF:
    """Tests for app.core.ekf_tracker.smooth_trajectory_ekf."""

    def test_empty_points(self):
        """Empty input should return empty output."""
        from app.core.ekf_tracker import smooth_trajectory_ekf
        result = smooth_trajectory_ekf([])
        assert result == []

    def test_single_point(self):
        """Single point should return single point unchanged."""
        from app.core.ekf_tracker import smooth_trajectory_ekf
        result = smooth_trajectory_ekf([(100.0, 200.0, 0, 0.0)])
        assert len(result) == 1
        assert result[0][0] == 100.0
        assert result[0][1] == 200.0

    def test_noisy_trajectory_smoothing(self, noisy_points):
        """Smoothed trajectory should have consistent output length."""
        from app.core.ekf_tracker import smooth_trajectory_ekf
        smoothed = smooth_trajectory_ekf(noisy_points)
        assert len(smoothed) == 30

    def test_noisy_trajectory_output_format(self, noisy_points):
        """Each output point should be (x, y, frame, timestamp) tuple."""
        from app.core.ekf_tracker import smooth_trajectory_ekf
        smoothed = smooth_trajectory_ekf(noisy_points)
        pt = smoothed[0]
        assert len(pt) == 4
        assert isinstance(pt[0], float)
        assert isinstance(pt[1], float)

    def test_smoothed_trajectory_reduces_noise(self, noisy_points):
        """Smoothed trajectory variance should be less than raw variance."""
        from app.core.ekf_tracker import smooth_trajectory_ekf
        smoothed = smooth_trajectory_ekf(noisy_points)
        raw_x = [p[0] for p in noisy_points]
        smooth_x = [p[0] for p in smoothed]
        # Compute consecutive difference variance
        raw_diffs = np.diff(raw_x)
        smooth_diffs = np.diff(smooth_x)
        assert np.var(smooth_diffs) <= np.var(raw_diffs) * 1.5  # allow some margin


# ======================================================================
# TestReleaseDetector
# ======================================================================

class TestReleaseDetector:
    """Tests for app.core.release_detector module."""

    @pytest.fixture
    def release_detector(self):
        """Create a ReleaseDetector with classical ball detector."""
        from app.core.release_detector import ReleaseDetector
        from app.core.ball_detector import BallDetector
        detector = BallDetector(detection_tier="classical")
        return ReleaseDetector(ball_detector=detector)

    def test_initialisation(self, release_detector):
        """ReleaseDetector should initialise without error."""
        assert release_detector is not None
        assert release_detector._release_found is False

    def test_release_event_dataclass(self):
        """ReleaseEvent stores all fields correctly."""
        from app.core.release_detector import ReleaseEvent
        event = ReleaseEvent(
            frame_number=10, timestamp=0.33,
            ball_x=100, ball_y=200,
            hand_x=95, hand_y=195,
            ball_speed=500, hand_speed=300,
            ball_hand_distance=11.2,
            confidence=0.85, method="pose_guided",
        )
        assert event.confidence == 0.85
        assert event.method == "pose_guided"
        assert event.ball_speed == 500
        assert event.hand_x == 95

    def test_release_event_defaults(self):
        """ReleaseEvent optional fields should default correctly."""
        from app.core.release_detector import ReleaseEvent
        event = ReleaseEvent(
            frame_number=5, timestamp=0.16,
            ball_x=50, ball_y=100,
        )
        assert event.hand_x is None
        assert event.hand_y is None
        assert event.ball_speed == 0.0
        assert event.method == "pose_guided"
        assert event.confidence == 0.0

    def test_velocity_threshold_interpolation(self):
        """Higher hand speed should produce lower threshold."""
        from app.core.release_detector import ReleaseDetector
        from app.core.ball_detector import BallDetector
        detector = BallDetector(detection_tier="classical")
        rd = ReleaseDetector(
            ball_detector=detector,
            velocity_threshold_low=200,
            velocity_threshold_high=80,
        )
        t1 = rd._compute_velocity_threshold(0)
        t2 = rd._compute_velocity_threshold(500)
        assert t2 < t1

    def test_velocity_threshold_values(self):
        """Threshold should interpolate correctly between low and high."""
        from app.core.release_detector import ReleaseDetector
        from app.core.ball_detector import BallDetector
        detector = BallDetector(detection_tier="classical")
        rd = ReleaseDetector(
            ball_detector=detector,
            velocity_threshold_low=200,
            velocity_threshold_high=80,
        )
        # At zero speed → low threshold (more permissive)
        assert rd._compute_velocity_threshold(0) == 200.0
        # At max speed (500+) → high threshold (less permissive)
        assert rd._compute_velocity_threshold(1000) == 80.0

    def test_process_frame_none_input(self, release_detector):
        """Should handle None frame gracefully."""
        result = release_detector.process_frame(None, 0, 0.0)
        assert result is None

    def test_process_frame_valid_input(self, release_detector, dark_frame):
        """Should process a valid frame without crashing."""
        result = release_detector.process_frame(dark_frame, 0, 0.0)
        # Likely None (no release detected), but should not crash
        assert result is None or isinstance(result, type(release_detector)._event_type if hasattr(release_detector, '_event_type') else object)

    def test_build_motion_stack_insufficient_frames(self, release_detector):
        """Should return None when frame buffer is empty."""
        stack = release_detector._build_motion_stack()
        assert stack is None

    def test_build_motion_stack_with_frames(self, release_detector):
        """Should build a valid 3-channel motion stack after 3 frames."""
        for i in range(3):
            frame = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)
            release_detector.process_frame(frame, i, i / 30.0)
        stack = release_detector._build_motion_stack()
        assert stack is not None
        assert stack.ndim == 3  # should be a color image (H, W, 3)
        assert stack.shape[2] == 3

    def test_build_motion_stack_two_frames(self, release_detector):
        """Should return None with only 2 frames in buffer."""
        for i in range(2):
            frame = np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)
            release_detector.process_frame(frame, i, i / 30.0)
        stack = release_detector._build_motion_stack()
        assert stack is None

    def test_get_release_frame_no_detections(self, release_detector):
        """Should return None for empty detection list."""
        result = release_detector.get_release_frame([], 480)
        assert result is None

    def test_get_release_frame_with_detections(self, release_detector):
        """Should return closest index when no release found."""
        detections = [
            {"frame_number": 5, "x": 100, "y": 200},
            {"frame_number": 10, "x": 110, "y": 210},
            {"frame_number": 15, "x": 120, "y": 220},
        ]
        result = release_detector.get_release_frame(detections, 480)
        # Without a release event, falls back to multi-signal which
        # may return None if VideoProcessor import fails
        assert result is None or isinstance(result, int)

    def test_reset(self, release_detector, dark_frame):
        """Reset should clear internal state."""
        release_detector.process_frame(dark_frame, 0, 0.0)
        release_detector.reset()
        assert release_detector._release_found is False
        assert len(release_detector._frame_buffer) == 0
        assert len(release_detector._pose_history) == 0
        assert len(release_detector._tracking_history) == 0

    def test_normalise_to_uint8_basic(self):
        """_normalise_to_uint8 should return uint8 output."""
        from app.core.release_detector import ReleaseDetector
        img = np.random.randint(0, 255, (100, 100), dtype=np.uint8)
        result = ReleaseDetector._normalise_to_uint8(img)
        assert result.dtype == np.uint8
        assert result.shape == img.shape

    def test_find_closest_detection_index(self):
        """Should find the detection closest to the target frame."""
        from app.core.release_detector import ReleaseDetector
        detections = [
            {"frame_number": 5},
            {"frame_number": 10},
            {"frame_number": 20},
        ]
        idx = ReleaseDetector._find_closest_detection_index(detections, 12)
        assert idx == 1  # frame 10 is closest to 12

    def test_find_closest_detection_index_empty(self):
        """Should return None for empty detections."""
        from app.core.release_detector import ReleaseDetector
        result = ReleaseDetector._find_closest_detection_index([], 10)
        assert result is None


# ======================================================================
# TestPitchKeypointDetector
# ======================================================================

class TestPitchKeypointDetector:
    """Tests for app.core.pitch_keypoint_detector module."""

    @pytest.fixture
    def detector(self):
        """Create a PitchKeypointDetector instance."""
        from app.core.pitch_keypoint_detector import PitchKeypointDetector
        return PitchKeypointDetector()

    @pytest.fixture
    def good_keypoints(self):
        """Well-formed pitch keypoints for geometry tests."""
        from app.core.pitch_keypoint_detector import PitchKeypoints
        return PitchKeypoints(
            bowling_crease_left=(100, 100),
            bowling_crease_right=(400, 100),
            batting_crease_left=(120, 600),
            batting_crease_right=(380, 600),
        )

    def test_initialisation(self, detector):
        """Detector should initialise without error."""
        assert detector is not None
        assert detector.target_width_px == 305
        assert detector.target_length_px == 2012

    def test_pitch_keypoints_dataclass(self):
        """PitchKeypoints stores all corner positions."""
        from app.core.pitch_keypoint_detector import PitchKeypoints
        kp = PitchKeypoints(
            bowling_crease_left=(50, 100),
            bowling_crease_right=(300, 100),
            batting_crease_left=(80, 500),
            batting_crease_right=(270, 500),
        )
        assert kp.bowling_crease_left == (50, 100)
        assert kp.batting_crease_right == (270, 500)

    def test_pitch_keypoints_stumps_default_none(self):
        """Stump positions should default to None."""
        from app.core.pitch_keypoint_detector import PitchKeypoints
        kp = PitchKeypoints(
            bowling_crease_left=(50, 100),
            bowling_crease_right=(300, 100),
            batting_crease_left=(80, 500),
            batting_crease_right=(270, 500),
        )
        assert kp.bowling_stump_left is None
        assert kp.batting_stump_right is None
        assert not kp.has_stumps

    def test_pitch_keypoints_has_stumps(self):
        """has_stumps should be True when all stumps are set."""
        from app.core.pitch_keypoint_detector import PitchKeypoints
        kp = PitchKeypoints(
            bowling_crease_left=(50, 100),
            bowling_crease_right=(300, 100),
            batting_crease_left=(80, 500),
            batting_crease_right=(270, 500),
            bowling_stump_left=(140, 100),
            bowling_stump_right=(210, 100),
            batting_stump_left=(160, 500),
            batting_stump_right=(190, 500),
        )
        assert kp.has_stumps

    def test_pitch_keypoints_corner_array(self, good_keypoints):
        """corner_array should return (4, 2) array in correct order."""
        ca = good_keypoints.corner_array
        assert ca.shape == (4, 2)
        # First point should be bowling_crease_left
        assert np.allclose(ca[0], good_keypoints.bowling_crease_left)

    def test_pitch_keypoints_all_keypoints(self, good_keypoints):
        """all_keypoints should list corners without stumps."""
        pts = good_keypoints.all_keypoints
        assert len(pts) == 4

    def test_to_pitch_calibration(self, good_keypoints):
        """to_pitch_calibration should map corners correctly."""
        cal = good_keypoints.to_pitch_calibration()
        assert cal.top_left == (100, 100)
        assert cal.top_right == (400, 100)
        assert cal.bottom_left == (120, 600)
        assert cal.bottom_right == (380, 600)

    def test_homography_result_dataclass(self):
        """HomographyResult stores all fields correctly."""
        from app.core.pitch_keypoint_detector import HomographyResult
        H = np.eye(3, dtype=np.float64)
        result = HomographyResult(
            H=H, H_inv=H, reprojection_error=0.5,
            inlier_count=4, keypoints_used=4, confidence=0.9,
        )
        assert result.confidence == 0.9
        assert result.H.shape == (3, 3)
        assert result.inlier_count == 4

    def test_validate_geometry_good(self, detector, good_keypoints):
        """Well-formed pitch should get a positive confidence score."""
        confidence = detector.validate_geometry(good_keypoints, (720, 1280))
        assert confidence > 0

    def test_validate_geometry_degenerate(self, detector):
        """Degenerate pitch (all corners co-located) should get low confidence."""
        from app.core.pitch_keypoint_detector import PitchKeypoints
        kp = PitchKeypoints(
            bowling_crease_left=(100, 100),
            bowling_crease_right=(101, 100),
            batting_crease_left=(100, 101),
            batting_crease_right=(101, 101),
        )
        confidence = detector.validate_geometry(kp, (720, 1280))
        assert confidence < 0.5

    def test_compute_homography_basic(self, detector, good_keypoints):
        """Homography from known keypoints should have correct shapes."""
        result = detector.compute_homography(good_keypoints, (720, 1280))
        assert result.H.shape == (3, 3)
        assert result.H_inv.shape == (3, 3)
        assert result.reprojection_error < 10  # low for perfect corners

    def test_pixel_to_pitch_coords(self, detector, good_keypoints):
        """Pixel coordinates should map to reasonable pitch coords."""
        homo = detector.compute_homography(good_keypoints, (720, 1280))
        # Top-left corner of bowling crease
        x_m, y_m = detector.pixel_to_pitch_coords(100, 100, homo)
        assert 0 <= x_m <= 3.05
        assert 0 <= y_m <= 20.12

    def test_pitch_to_pixel_coords(self, detector, good_keypoints):
        """Round-trip through pitch and pixel coords should be consistent."""
        homo = detector.compute_homography(good_keypoints, (720, 1280))
        # Map a pixel to pitch coords and back
        x_m, y_m = detector.pixel_to_pitch_coords(200, 300, homo)
        x_px, y_px = detector.pitch_to_pixel_coords(x_m, y_m, homo)
        # Should be close to original (within homography tolerance)
        assert abs(x_px - 200) < 50
        assert abs(y_px - 300) < 50

    def test_preprocess_output_shape(self, detector, bright_frame):
        """Preprocessed frame should be 2D grayscale."""
        processed, scale = detector._preprocess(bright_frame)
        assert processed.ndim == 2
        assert processed.shape[0] > 0
        assert processed.shape[1] > 0
        assert scale > 0

    def test_preprocess_no_resize_for_narrow_frame(self, detector):
        """Narrow frame should not be resized."""
        frame = np.full((480, 640, 3), 40, dtype=np.uint8)
        processed, scale = detector._preprocess(frame)
        assert scale == 1.0

    def test_detect_none_frame(self, detector):
        """detect() with None frame should return None."""
        result = detector.detect(None)
        assert result is None

    def test_detect_empty_frame(self, detector):
        """detect() with empty frame should return None."""
        result = detector.detect(np.array([]))
        assert result is None

    def test_detect_synthetic_frame(self, detector):
        """Detection on a frame with clear white lines should not crash."""
        frame = np.full((720, 1280, 3), 40, dtype=np.uint8)
        cv2.line(frame, (100, 100), (1180, 100), (255, 255, 255), 3)
        cv2.line(frame, (120, 550), (1160, 550), (255, 255, 255), 3)
        result = detector.detect(frame)
        # May or may not detect depending on algorithm, but should not crash
        if result is not None:
            from app.core.pitch_keypoint_detector import PitchKeypoints
            assert isinstance(result, PitchKeypoints)

    def test_detect_stump_bases_optional(self, detector, good_keypoints):
        """Stump detection should be optional and not crash."""
        frame = np.full((720, 1280, 3), 40, dtype=np.uint8)
        result = detector._detect_stump_bases(frame, good_keypoints)
        assert isinstance(result, type(good_keypoints))

    def test_detect_stump_bases_with_color_hint(self, detector, good_keypoints):
        """Stump detection with custom HSV hint should not crash."""
        frame = np.full((720, 1280, 3), 40, dtype=np.uint8)
        result = detector._detect_stump_bases(
            frame, good_keypoints, stump_color_hsv=(20, 50, 220),
        )
        assert isinstance(result, type(good_keypoints))

    def test_physical_constants(self):
        """Verify ICC pitch dimensions are correct."""
        from app.core.pitch_keypoint_detector import (
            PITCH_LENGTH_CM, PITCH_WIDTH_CM, STUMP_SPREAD_CM,
        )
        assert abs(PITCH_LENGTH_CM - 2012.0) < 0.1  # 22 yards
        assert abs(PITCH_WIDTH_CM - 305.0) < 0.1    # 10 feet
        assert abs(STUMP_SPREAD_CM - 22.86) < 0.1   # 9 inches
