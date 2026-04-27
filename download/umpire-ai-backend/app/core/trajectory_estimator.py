"""
Trajectory estimation with Kalman filtering.

Provides a lightweight 2-D Kalman filter for smoothing noisy ball
positions and estimating derived quantities such as pitch point, ball
speed, lateral deviation, and stump-hit prediction.
"""

import numpy as np
from typing import Optional, List, Tuple
from dataclasses import dataclass


@dataclass
class TrajectoryPoint:
    """A ball position mapped to normalised pitch coordinates.

    Attributes:
        x: Horizontal position normalised to [0, 1].
        y: Vertical position normalised to [0, 1]
            (0 = bowling end, 1 = batsman end).
        z: Estimated height (0 = ground, 1 = maximum visible height).
        frame_number: Frame index in the source video.
        timestamp: Video timestamp in seconds.
    """
    x: float
    y: float
    z: float
    frame_number: int
    timestamp: float


@dataclass
class TrajectoryPrediction:
    """Full trajectory analysis result.

    Attributes:
        points: Ordered list of normalised trajectory points.
        pitch_point: Where the ball bounced (pitch mark).
        impact_point: Where the ball made contact (pad / bat / stumps).
        predicted_stump_hit: Whether the extrapolated path hits stumps.
        deviation_degrees: Lateral deviation after pitching (degrees).
        ball_speed_mps: Estimated ball speed in metres per second.
        confidence: Overall confidence score [0, 1].
    """
    points: List[TrajectoryPoint]
    pitch_point: Optional[TrajectoryPoint] = None
    impact_point: Optional[TrajectoryPoint] = None
    predicted_stump_hit: bool = False
    deviation_degrees: float = 0.0
    ball_speed_mps: float = 0.0
    confidence: float = 0.0


class KalmanFilter2D:
    """Simple constant-velocity 2-D Kalman filter.

    State vector: ``[x, y, vx, vy]``
    Measurement vector: ``[x, y]``
    """

    def __init__(self, dt: float = 1.0 / 30.0):
        self.dt = dt
        self.state = np.zeros(4, dtype=np.float64)
        self.P = np.eye(4, dtype=np.float64) * 1000.0
        self.F = np.array(
            [[1, 0, dt, 0],
             [0, 1, 0, dt],
             [0, 0, 1,  0],
             [0, 0, 0,  1]],
            dtype=np.float64,
        )
        self.H = np.array(
            [[1, 0, 0, 0],
             [0, 1, 0, 0]],
            dtype=np.float64,
        )
        self.Q = np.eye(4, dtype=np.float64) * 0.01
        self.R = np.eye(2, dtype=np.float64) * 1.0
        self.initialized = False

    def predict(self) -> None:
        """Run the predict step of the Kalman filter."""
        if not self.initialized:
            return
        self.state = self.F @ self.state
        self.P = self.F @ self.P @ self.F.T + self.Q

    def update(self, z: np.ndarray) -> None:
        """Run the update (correction) step.

        Args:
            z: Measurement vector ``[x, y]``.
        """
        if not self.initialized:
            self.state[:2] = z.astype(np.float64)
            self.initialized = True
            return

        y = z - self.H @ self.state
        S = self.H @ self.P @ self.H.T + self.R
        K = self.P @ self.H.T @ np.linalg.inv(S)
        self.state = self.state + K @ y
        self.P = (np.eye(4) - K @ self.H) @ self.P

    def get_state(self) -> np.ndarray:
        """Return a copy of the current state vector."""
        return self.state.copy()


class TrajectoryEstimator:
    """Estimates and predicts ball trajectory using Kalman filtering.

    Usage::

        estimator = TrajectoryEstimator()
        for detection in detections:
            estimator.add_point(detection.x, detection.y,
                                detection.frame_number, detection.timestamp)
        result = estimator.estimate(frame_shape=(720, 1280))
    """

    def __init__(self, dt: float = 1.0 / 30.0):
        self.kf = KalmanFilter2D(dt=dt)
        self.raw_points: List[Tuple[float, float, int, float]] = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add_point(
        self, x: float, y: float, frame: int, timestamp: float
    ) -> None:
        """Record a detected ball position.

        Args:
            x: Horizontal pixel position.
            y: Vertical pixel position.
            frame: Frame index.
            timestamp: Video timestamp in seconds.
        """
        self.raw_points.append((x, y, frame, timestamp))
        self.kf.predict()
        self.kf.update(np.array([x, y], dtype=np.float64))

    def estimate(self, frame_shape: Tuple[int, int]) -> TrajectoryPrediction:
        """Run full trajectory estimation over all accumulated points.

        Args:
            frame_shape: ``(height, width, channels)`` of the source frame.

        Returns:
            A :class:`TrajectoryPrediction` with all derived metrics.
        """
        if len(self.raw_points) < 3:
            return TrajectoryPrediction(points=[], confidence=0.0)

        smoothed = self._smooth_trajectory()

        h, w = frame_shape[:2]
        normalized = [
            TrajectoryPoint(
                x=p[0] / w, y=p[1] / h, z=0.0,
                frame_number=int(p[2]), timestamp=p[3],
            )
            for p in smoothed
        ]

        pitch_point = self._detect_pitch_point(normalized)
        deviation = self._calculate_deviation(normalized)
        speed = self._calculate_speed(normalized)
        stump_hit = self._predict_stump_hit(normalized)
        confidence = min(len(normalized) / 20.0, 0.95)

        return TrajectoryPrediction(
            points=normalized,
            pitch_point=pitch_point,
            impact_point=normalized[-1] if normalized else None,
            predicted_stump_hit=stump_hit,
            deviation_degrees=deviation,
            ball_speed_mps=speed,
            confidence=round(confidence, 3),
        )

    def reset(self) -> None:
        """Clear all accumulated data and reset the filter."""
        self.raw_points.clear()
        self.kf = KalmanFilter2D(dt=self.kf.dt)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _smooth_trajectory(
        self,
    ) -> List[Tuple[float, float, float, float]]:
        """Apply Kalman smoothing to raw points.

        Returns:
            List of ``(x, y, frame, timestamp)`` tuples.
        """
        kf = KalmanFilter2D()
        smoothed: List[Tuple[float, float, float, float]] = []
        for x, y, frame, ts in self.raw_points:
            kf.predict()
            kf.update(np.array([x, y], dtype=np.float64))
            state = kf.get_state()
            smoothed.append((float(state[0]), float(state[1]), frame, ts))
        return smoothed

    def _detect_pitch_point(
        self, points: List[TrajectoryPoint]
    ) -> Optional[TrajectoryPoint]:
        """Identify where the ball pitched by detecting a local extremum
        in the vertical (y) direction that reverses."""
        if len(points) < 5:
            return None

        for i in range(1, len(points) - 1):
            dy_before = points[i].y - points[i - 1].y
            dy_after = points[i + 1].y - points[i].y
            if dy_before > 0 and dy_after < 0:
                return points[i]

        # Fallback: estimate pitch at roughly one-third of trajectory
        return points[len(points) // 3] if points else None

    def _calculate_deviation(self, points: List[TrajectoryPoint]) -> float:
        """Compute the lateral deviation after the pitch point, in degrees."""
        if len(points) < 3:
            return 0.0

        mid = len(points) // 3
        if mid < 1 or mid >= len(points) - 1:
            return 0.0

        dx_before = points[mid].x - points[0].x
        dy_before = points[mid].y - points[0].y
        dx_after = points[-1].x - points[mid].x
        dy_after = points[-1].y - points[mid].y

        angle_before = float(np.arctan2(dx_before, dy_before))
        angle_after = float(np.arctan2(dx_after, dy_after))

        return round(float(np.degrees(angle_after - angle_before)), 1)

    def _calculate_speed(self, points: List[TrajectoryPoint]) -> float:
        """Estimate ball speed in m/s, scaling the normalised trajectory
        distance to the real pitch length (20.12 m)."""
        if len(points) < 2:
            return 0.0

        total_dist = 0.0
        for i in range(1, len(points)):
            dx = points[i].x - points[i - 1].x
            dy = points[i].y - points[i - 1].y
            total_dist += float(np.sqrt(dx ** 2 + dy ** 2))

        duration = points[-1].timestamp - points[0].timestamp
        if duration <= 0:
            return 0.0

        real_distance = total_dist * 20.12
        return round(real_distance / duration, 1)

    def _predict_stump_hit(self, points: List[TrajectoryPoint]) -> bool:
        """Extrapolate the last portion of the trajectory to the stump
        line (y ≈ 0.9) and check if the predicted x is within the
        stump zone (0.45 – 0.55 in normalised coords)."""
        if len(points) < 5:
            return False

        last = points[-1]
        prev = points[-2]
        dx = last.x - prev.x
        dy = last.y - prev.y

        if abs(dy) < 1e-4:
            return False

        steps = int((0.9 - last.y) / dy) if dy > 0 else 0
        predicted_x = last.x + dx * steps

        stump_half_width = 0.05
        return abs(predicted_x - 0.5) < stump_half_width
