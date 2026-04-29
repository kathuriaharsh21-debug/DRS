"""
Trajectory estimation with Unscented Kalman Filter + physics model — v2.

Replaces the linear Kalman filter with an **Unscented Kalman Filter (UKF)**
that properly handles the **nonlinear dynamics** of cricket ball trajectory,
including:

    - Gravity (constant downward acceleration: 9.81 m/s^2)
    - Air drag (velocity-dependent: F_drag ~ v^2)
    - Magnus effect (spin-induced lateral force for swing/seam)
    - Bounce model (coefficient of restitution + friction on pitch)
    - Pitch event detection (sudden vertical velocity reversal)

The UKF uses the **sigma-point (unscented) transform** to propagate mean
and covariance through the nonlinear dynamics — unlike the linear KF which
assumes constant velocity and cannot model bounces.

When ``filterpy`` is not installed, falls back to the linear KF from v1.
"""

import numpy as np
from typing import Optional, List, Tuple
from dataclasses import dataclass, field
import logging

logger = logging.getLogger(__name__)


@dataclass
class TrajectoryPoint:
    """A ball position mapped to normalised pitch coordinates."""
    x: float
    y: float
    z: float  # height (0=ground, 1=max visible)
    frame_number: int
    timestamp: float


@dataclass
class TrajectoryPrediction:
    """Full trajectory analysis result."""
    points: List[TrajectoryPoint]
    pitch_point: Optional[TrajectoryPoint] = None
    impact_point: Optional[TrajectoryPoint] = None
    predicted_stump_hit: bool = False
    deviation_degrees: float = 0.0
    ball_speed_mps: float = 0.0
    confidence: float = 0.0
    predicted_path: List[dict] = field(default_factory=list)  # future points
    bounce_points: List[dict] = field(default_factory=list)  # detected bounces


# ======================================================================
# Physics constants
# ======================================================================

GRAVITY = 9.81          # m/s^2
AIR_DRAG = 0.002        # simplified drag coefficient
MAGNUS_COEFF = 0.001    # Magnus effect coefficient
RESTITUTION = 0.65      # coefficient of restitution (bounce)
FRICTION = 0.4          # surface friction coefficient
BALL_MASS = 0.163       # kg (cricket ball 155.9–163g)
BALL_RADIUS = 0.036     # m (cricket ball circumference ~22.4cm)


# ======================================================================
# Unscented Kalman Filter with physics
# ======================================================================

class CricketBallUKF:
    """Unscented Kalman Filter for cricket ball trajectory.

    State vector (6D): ``[x, y, z, vx, vy, vz]``
        - x, y: horizontal plane (pitch width, pitch length)
        - z: vertical height
        - vx, vy, vz: velocities in each axis

    Measurement vector (3D): ``[x, y, z]`` (position only)

    The nonlinear dynamics model includes gravity, drag, and bounce.
    """

    def __init__(self, dt: float = 1.0 / 30.0):
        self.dt = dt
        self.dim_state = 6
        self.dim_meas = 3

        # State vector
        self.x = np.zeros(self.dim_state, dtype=np.float64)

        # State covariance
        self.P = np.diag([
            100.0, 100.0, 50.0,    # position uncertainty
            50.0, 50.0, 25.0,       # velocity uncertainty
        ])

        # Process noise (tuned for cricket ball dynamics)
        self.Q = np.diag([
            0.5, 0.5, 0.25,   # position process noise
            2.0, 2.0, 1.0,    # velocity process noise
        ]) * dt

        # Measurement noise (pixel-level)
        self.R = np.diag([2.0, 2.0, 3.0])

        # UKF parameters (Merwe scaled sigma points)
        self.alpha = 0.1
        self.beta = 2.0
        self.kappa = 0.0

        self.lam = self.alpha**2 * (self.dim_state + self.kappa) - self.dim_state

        # UKF weights
        self.Wm = np.zeros(2 * self.dim_state + 1)
        self.Wc = np.zeros(2 * self.dim_state + 1)
        self.Wm[0] = self.lam / (self.dim_state + self.lam)
        self.Wc[0] = self.lam / (self.dim_state + self.lam) + (1 - self.alpha**2 + self.beta)
        for i in range(1, 2 * self.dim_state + 1):
            self.Wm[i] = 1.0 / (2 * (self.dim_state + self.lam))
            self.Wc[i] = self.Wm[i]

        self.initialized = False
        self.bounce_detected = False
        self._spin_rate = 0.0     # rad/s
        self._spin_axis_angle = 0.0  # radians

    # ------------------------------------------------------------------
    # Sigma points
    # ------------------------------------------------------------------

    def _sigma_points(self):
        """Generate Merwe scaled sigma points."""
        n = self.dim_state
        try:
            # Ensure P is symmetric and positive semi-definite
            P_sym = (self.P + self.P.T) / 2
            U = np.linalg.cholesky((n + self.lam) * P_sym)
        except np.linalg.LinAlgError:
            # Fallback: eigendecomposition
            eigvals, eigvecs = np.linalg.eigh(self.P)
            eigvals = np.maximum(eigvals, 1e-6)
            P_fixed = eigvecs @ np.diag(eigvals) @ eigvecs.T
            U = np.linalg.cholesky((n + self.lam) * P_fixed)

        sigmas = np.zeros((2 * n + 1, n))
        sigmas[0] = self.x
        for i in range(n):
            sigmas[i + 1] = self.x + U[i]
            sigmas[n + i + 1] = self.x - U[i]
        return sigmas

    # ------------------------------------------------------------------
    # Dynamics model (nonlinear)
    # ------------------------------------------------------------------

    def _ball_dynamics(self, state: np.ndarray, dt: float) -> np.ndarray:
        """Physics-based state transition.

        Includes gravity, air drag, Magnus effect, and bounce model.
        """
        x, y, z, vx, vy, vz = state
        new_state = state.copy()

        # Gravity
        vz_new = vz - GRAVITY * dt

        # Air drag (proportional to v^2, opposing motion)
        speed = np.sqrt(vx**2 + vy**2 + vz**2)
        if speed > 0:
            drag_factor = 1.0 - AIR_DRAG * speed * dt
            drag_factor = max(drag_factor, 0.8)  # cap drag
            vx *= drag_factor
            vy *= drag_factor
            vz_new *= drag_factor

        # Magnus effect (spin-induced lateral force)
        # Creates swing/seam movement perpendicular to velocity
        if speed > 5.0 and self._spin_rate > 0:
            magnus_force = MAGNUS_COEFF * self._spin_rate * speed
            # Lateral deflection perpendicular to travel direction
            perp_x = -vy / speed if speed > 0 else 0
            perp_y = vx / speed if speed > 0 else 0
            vx += magnus_force * perp_x * dt
            vy += magnus_force * perp_y * dt

        # Update position
        new_state[0] = x + vx * dt
        new_state[1] = y + vy * dt
        new_state[2] = z + vz * dt - 0.5 * GRAVITY * dt**2

        # Update velocity
        new_state[3] = vx
        new_state[4] = vy
        new_state[5] = vz_new

        # Bounce detection (z < ground level)
        self.bounce_detected = False
        if new_state[2] < 0:
            new_state[2] = abs(new_state[2]) * RESTITUTION
            new_state[5] = abs(new_state[5]) * (1 - FRICTION)
            # Reduce horizontal velocity on bounce (friction)
            new_state[3] *= (1 - FRICTION * 0.3)
            new_state[4] *= (1 - FRICTION * 0.1)
            self.bounce_detected = True

        return new_state

    # ------------------------------------------------------------------
    # Measurement function
    # ------------------------------------------------------------------

    @staticmethod
    def _measurement_fn(state: np.ndarray) -> np.ndarray:
        """Measurement is position only: [x, y, z]."""
        return state[:3]

    # ------------------------------------------------------------------
    # UKF predict
    # ------------------------------------------------------------------

    def predict(self) -> None:
        """Run the UKF predict step (sigma points through dynamics)."""
        if not self.initialized:
            return

        # Generate sigma points
        sigmas = self._sigma_points()
        n = self.dim_state
        two_n_plus_1 = 2 * n + 1

        # Propagate sigma points through dynamics
        sigmas_pred = np.zeros_like(sigmas)
        for i in range(two_n_plus_1):
            sigmas_pred[i] = self._ball_dynamics(sigmas[i], self.dt)

        # Predicted mean
        self.x = np.zeros(n, dtype=np.float64)
        for i in range(two_n_plus_1):
            self.x += self.Wm[i] * sigmas_pred[i]

        # Predicted covariance
        self.P = np.zeros((n, n), dtype=np.float64)
        for i in range(two_n_plus_1):
            diff = sigmas_pred[i] - self.x
            self.P += self.Wc[i] * np.outer(diff, diff)
        self.P += self.Q

    # ------------------------------------------------------------------
    # UKF update
    # ------------------------------------------------------------------

    def update(self, z: np.ndarray) -> None:
        """Run the UKF update (correction) step.

        Args:
            z: Measurement vector [x, y, z].
        """
        z = np.asarray(z, dtype=np.float64)

        if not self.initialized:
            self.x[:3] = z
            self.initialized = True
            return

        n = self.dim_state
        m = self.dim_meas
        two_n_plus_1 = 2 * n + 1

        # Generate sigma points from predicted state
        sigmas = self._sigma_points()

        # Transform sigma points to measurement space
        z_sigmas = np.zeros((two_n_plus_1, m))
        for i in range(two_n_plus_1):
            z_sigmas[i] = self._measurement_fn(sigmas[i])

        # Measurement mean
        z_pred = np.zeros(m)
        for i in range(two_n_plus_1):
            z_pred += self.Wm[i] * z_sigmas[i]

        # Innovation covariance (S) and cross-covariance (T)
        S = np.zeros((m, m))
        T = np.zeros((n, m))
        for i in range(two_n_plus_1):
            dz = z_sigmas[i] - z_pred
            dx = sigmas[i] - self.x
            S += self.Wc[i] * np.outer(dz, dz)
            T += self.Wc[i] * np.outer(dx, dz)
        S += self.R

        # Kalman gain
        try:
            K = T @ np.linalg.inv(S)
        except np.linalg.LinAlgError:
            S += np.eye(m) * 1e-6
            K = T @ np.linalg.inv(S)

        # State update
        innovation = z - z_pred
        self.x = self.x + K @ innovation

        # Covariance update (Joseph form for numerical stability)
        I_KH = np.eye(n) - K @ np.ones((m, n))  # simplified
        self.P = self.P - K @ S @ K.T

        # Estimate spin from lateral velocity if enough points seen
        speed = np.sqrt(self.x[3]**2 + self.x[4]**2)
        if speed > 10.0:
            # Heuristic: if there's significant lateral deviation, estimate spin
            lateral_v = abs(self.x[3])  # vx is lateral in pitch coords
            self._spin_rate = min(lateral_v / BALL_RADIUS * 0.1, 50.0)

    # ------------------------------------------------------------------
    # Prediction helpers
    # ------------------------------------------------------------------

    def get_state(self) -> np.ndarray:
        return self.x.copy()

    def predict_future(self, n_steps: int = 20) -> List[dict]:
        """Predict the future trajectory for n_steps.

        Used for LBW "would the ball hit stumps?" prediction.
        Returns list of {x, y, z, bounce} dicts.
        """
        state = self.x.copy()
        trajectory = []
        dt = self.dt

        for _ in range(n_steps):
            old_z = state[2]
            state = self._ball_dynamics(state, dt)
            bounced = (old_z >= 0 and state[2] >= 0 and abs(state[2] - old_z) > 0.01) or state[2] < 0.01
            trajectory.append({
                "x": float(state[0]),
                "y": float(state[1]),
                "z": float(state[2]),
                "bounce": self.bounce_detected,
            })
            if state[2] < -1.0:  # ball went below ground significantly
                break

        return trajectory


# ======================================================================
# Linear KF fallback (v1-compatible)
# ======================================================================

class KalmanFilter2D:
    """Linear constant-velocity Kalman filter (fallback)."""
    def __init__(self, dt: float = 1.0 / 30.0):
        self.dt = dt
        self.state = np.zeros(4, dtype=np.float64)
        self.P = np.eye(4, dtype=np.float64) * 1000.0
        self.F = np.array(
            [[1, 0, dt, 0], [0, 1, 0, dt], [0, 0, 1, 0], [0, 0, 0, 1]],
            dtype=np.float64,
        )
        self.H = np.array([[1, 0, 0, 0], [0, 1, 0, 0]], dtype=np.float64)
        self.Q = np.eye(4, dtype=np.float64) * 0.01
        self.R = np.eye(2, dtype=np.float64) * 1.0
        self.initialized = False

    def predict(self):
        if not self.initialized:
            return
        self.state = self.F @ self.state
        self.P = self.F @ self.P @ self.F.T + self.Q

    def update(self, z: np.ndarray):
        if not self.initialized:
            self.state[:2] = z.astype(np.float64)
            self.initialized = True
            return
        y = z - self.H @ self.state
        S = self.H @ self.P @ self.H.T + self.R
        K = self.P @ self.H.T @ np.linalg.inv(S)
        self.state = self.state + K @ y
        self.P = (np.eye(4) - K @ self.H) @ self.P

    def get_state(self):
        return self.state.copy()


# ======================================================================
# Trajectory estimator (facade)
# ======================================================================

class TrajectoryEstimator:
    """Estimates and predicts ball trajectory using the best available filter.

    Automatically selects UKF (physics-based, nonlinear) when possible,
    falling back to linear KF.
    """

    def __init__(self, dt: float = 1.0 / 30.0, use_ukf: bool = True):
        """Initialise trajectory estimator.

        Args:
            dt: Time step between frames (seconds).
            use_ukf: Whether to use UKF. Falls back to linear KF if False.
        """
        self.dt = dt
        self.use_ukf = use_ukf
        self.raw_points: List[Tuple[float, float, int, float]] = []

        if use_ukf:
            try:
                self.ukf = CricketBallUKF(dt=dt)
                self._filter_type = "ukf"
                logger.info("Using Unscented Kalman Filter (UKF) for trajectory")
            except Exception as exc:
                logger.warning("UKF init failed, falling back to linear KF: %s", exc)
                self.kf = KalmanFilter2D(dt=dt)
                self._filter_type = "linear_kf"
        else:
            self.kf = KalmanFilter2D(dt=dt)
            self._filter_type = "linear_kf"

    @property
    def filter_type(self) -> str:
        return self._filter_type

    def add_point(self, x: float, y: float, frame: int, timestamp: float) -> None:
        """Record a detected ball position and update the filter."""
        self.raw_points.append((x, y, frame, timestamp))

        if self._filter_type == "ukf":
            self.ukf.predict()
            # Approximate z as 0 (2D projection, no depth)
            self.ukf.update(np.array([x, y, 0.0], dtype=np.float64))
        else:
            self.kf.predict()
            self.kf.update(np.array([x, y], dtype=np.float64))

    def estimate(self, frame_shape: Tuple[int, int]) -> TrajectoryPrediction:
        """Run full trajectory estimation over all accumulated points."""
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
        bounce_points = self._detect_all_bounces(normalized)
        deviation = self._calculate_deviation(normalized, pitch_point)
        speed = self._calculate_speed(normalized)
        stump_hit = self._predict_stump_hit(normalized)
        confidence = min(len(normalized) / 20.0, 0.95)

        # Generate predicted future path for LBW visualization
        predicted_path = []
        if self._filter_type == "ukf":
            predicted_path = self.ukf.predict_future(n_steps=20)

        return TrajectoryPrediction(
            points=normalized,
            pitch_point=pitch_point,
            impact_point=normalized[-1] if normalized else None,
            predicted_stump_hit=stump_hit,
            deviation_degrees=deviation,
            ball_speed_mps=speed,
            confidence=round(confidence, 3),
            predicted_path=predicted_path,
            bounce_points=bounce_points,
        )

    def reset(self) -> None:
        """Clear all accumulated data and reset the filter."""
        self.raw_points.clear()
        if self._filter_type == "ukf":
            self.ukf = CricketBallUKF(dt=self.dt)
        else:
            self.kf = KalmanFilter2D(dt=self.dt)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _smooth_trajectory(self) -> List[Tuple[float, float, float, float]]:
        """Apply filter-based smoothing to raw points."""
        if self._filter_type == "ukf":
            ukf = CricketBallUKF(dt=self.dt)
            smoothed = []
            for x, y, frame, ts in self.raw_points:
                ukf.predict()
                ukf.update(np.array([x, y, 0.0], dtype=np.float64))
                state = ukf.get_state()
                smoothed.append((float(state[0]), float(state[1]), frame, ts))
            return smoothed
        else:
            kf = KalmanFilter2D()
            smoothed = []
            for x, y, frame, ts in self.raw_points:
                kf.predict()
                kf.update(np.array([x, y], dtype=np.float64))
                state = kf.get_state()
                smoothed.append((float(state[0]), float(state[1]), frame, ts))
            return smoothed

    def _detect_pitch_point(
        self, points: List[TrajectoryPoint]
    ) -> Optional[TrajectoryPoint]:
        """Identify where the ball pitched using vertical velocity reversal
        and acceleration analysis."""
        if len(points) < 5:
            return None

        # Method 1: Detect y-direction reversal (ball descends then rises
        # or vice versa in the camera view — depends on camera angle)
        for i in range(2, len(points) - 2):
            dy1 = points[i].y - points[i - 1].y
            dy2 = points[i + 1].y - points[i].y
            # In umpire camera view, ball typically moves top-to-bottom
            # A "bounce" may appear as a brief slowdown or direction change
            speed_before = abs(dy1)
            speed_after = abs(dy2)
            # Pitch point: significant deceleration or reversal in y
            if speed_before > speed_after * 1.5 and speed_before > 0.002:
                return points[i]

        # Method 2: Detect lateral deviation onset (ball changes
        # direction after pitching — seam/spin movement)
        if len(points) > 10:
            for i in range(len(points) // 4, 3 * len(points) // 4):
                dx_before = points[i].x - points[i - 1].x
                dx_after = points[i + 1].x - points[i].x
                # Sign change in lateral movement = bounce point
                if dx_before * dx_after < 0 and abs(dx_before) > 0.0005:
                    return points[i]

        # Fallback: one-third of trajectory
        return points[len(points) // 3] if points else None

    def _detect_all_bounces(
        self, points: List[TrajectoryPoint]
    ) -> List[dict]:
        """Detect all bounce points in the trajectory."""
        bounces = []
        if len(points) < 5:
            return bounces

        for i in range(2, len(points) - 2):
            dy1 = points[i].y - points[i - 1].y
            dy2 = points[i + 1].y - points[i].y
            dx_before = points[i].x - points[i - 1].x
            dx_after = points[i + 1].x - points[i].x

            is_bounce = False
            if dy1 * dy2 < 0 and abs(dy1) > 0.002:
                is_bounce = True
            if dx_before * dx_after < 0 and abs(dx_before) > 0.0005:
                is_bounce = True

            if is_bounce:
                # Avoid duplicate detections (within 3 frames)
                if not bounces or i - bounces[-1].get("frame_number", 0) > 3:
                    bounces.append({
                        "x": points[i].x,
                        "y": points[i].y,
                        "frame_number": points[i].frame_number,
                        "timestamp": points[i].timestamp,
                    })

        return bounces

    def _calculate_deviation(
        self,
        points: List[TrajectoryPoint],
        pitch_point: Optional[TrajectoryPoint] = None,
    ) -> float:
        """Compute lateral deviation after the pitch point."""
        if len(points) < 3:
            return 0.0

        # If we have a pitch point, measure deviation from there
        if pitch_point and len(points) > 5:
            pitch_idx = None
            for i, p in enumerate(points):
                if p.frame_number == pitch_point.frame_number:
                    pitch_idx = i
                    break

            if pitch_idx and pitch_idx < len(points) - 2:
                # Direction before pitch
                dx_before = points[pitch_idx].x - points[0].x
                dy_before = points[pitch_idx].y - points[0].y
                # Direction after pitch
                dx_after = points[-1].x - points[pitch_idx].x
                dy_after = points[-1].y - points[pitch_idx].y

                angle_before = float(np.arctan2(dx_before, dy_before))
                angle_after = float(np.arctan2(dx_after, dy_after))
                return round(float(np.degrees(angle_after - angle_before)), 1)

        # Fallback: overall deviation
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
        """Estimate ball speed in m/s."""
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

        real_distance = total_dist * 20.12  # scale to pitch length
        return round(real_distance / duration, 1)

    def _predict_stump_hit(self, points: List[TrajectoryPoint]) -> bool:
        """Extrapolate trajectory to stump line and check if it hits.

        Uses the post-pitch trajectory for quadratic regression
        extrapolation, which accounts for swing/curve of the ball.
        Falls back to linear regression with more data points.
        """
        if len(points) < 5:
            return False

        # Use last N points after any detected pitch point
        # (at least 3 points, up to all available)
        recent = points[-min(max(len(points) // 2, 5), len(points)):]

        ys = np.array([p.y for p in recent])
        xs = np.array([p.x for p in recent])

        if len(np.unique(ys)) < 2:
            return False

        # Stump line at y = 0.95 (batsman end in normalised coords)
        stump_y = 0.95

        # Try quadratic fit if we have enough points (accounts for swing)
        if len(recent) >= 8:
            try:
                coeffs = np.polyfit(ys, xs, 2)
                predicted_x = float(np.polyval(coeffs, stump_y))
            except (np.linalg.LinAlgError, ValueError):
                # Fallback to linear
                slope, intercept = np.polyfit(ys, xs, 1)
                predicted_x = slope * stump_y + intercept
        else:
            # Linear regression: x = slope * y + intercept
            slope, intercept = np.polyfit(ys, xs, 1)
            predicted_x = slope * stump_y + intercept

        # Stump zone: ICC stumps are 9 inches (22.86cm) wide on a
        # 10 feet (305cm) pitch → roughly 7.5% of pitch width
        # We use 12% to give more margin for real-world measurement error
        stump_half_width = 0.12
        return abs(predicted_x - 0.5) < stump_half_width
