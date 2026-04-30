"""
Extended Kalman Filter (EKF) for cricket ball trajectory tracking
with sub-pixel refinement.

Provides:

    **ExtendedKalmanFilter (EKF):**
    6-D state vector ``[x, y, z, vx, vy, vz]`` with Jacobian-based
    linearization.  The nonlinear dynamics model includes gravity,
    quadratic air drag, Magnus effect, and a bounce model with
    restitution and friction.  Adaptive measurement noise scales
    with detection confidence.  Occlusion handling grows covariance
    during missed frames and predicts forward using physics only.

    **SubPixelRefiner:**
    Refines integer-pixel ball centroids to sub-pixel accuracy using
    three complementary techniques:
        1. OpenCV ``cornerSubPix`` iterative refinement
        2. Spatial moments (``cv2.moments``) on a thresholded ball mask
        3. Intensity-gradient weighted centroid within the ball region
    The method with the highest confidence is returned.

    **Helper functions:**
    ``refine_detections_subpixel`` batch-processes all detections in a
    frame; ``smooth_trajectory_ekf`` runs the full EKF predict-update
    loop over a list of (x, y, frame, timestamp) tuples.
"""

import logging
import numpy as np
import cv2
from typing import Optional, List, Tuple
from dataclasses import dataclass

logger = logging.getLogger(__name__)


# ======================================================================
# Physics constants (same as trajectory_estimator.py)
# ======================================================================

GRAVITY = 9.81          # m/s^2
AIR_DRAG = 0.002        # simplified quadratic drag coefficient
MAGNUS_COEFF = 0.001    # Magnus effect coefficient
RESTITUTION = 0.65      # coefficient of restitution (bounce)
FRICTION = 0.4          # surface friction coefficient
BALL_MASS = 0.163       # kg (cricket ball 155.9-163 g)
BALL_RADIUS_M = 0.036   # m (circumference ~22.4 cm)


# ======================================================================
# Data classes
# ======================================================================

@dataclass
class EKFState:
    """Full 6D state: ``[x, y, z, vx, vy, vz]``."""
    x: float
    y: float
    z: float
    vx: float
    vy: float
    vz: float
    timestamp: float
    frame_number: int


@dataclass
class SubPixelDetection:
    """Ball detection with sub-pixel refined centroid."""
    x: float           # sub-pixel x
    y: float           # sub-pixel y
    radius: float
    confidence: float
    frame_number: int
    timestamp: float


# ======================================================================
# Extended Kalman Filter with physics-based dynamics
# ======================================================================

class ExtendedKalmanFilter:
    """Extended Kalman Filter for cricket ball trajectory tracking.

    State vector (6D): ``[x, y, z, vx, vy, vz]``
        - x, y: horizontal plane (pitch width, pitch length)
        - z: vertical height
        - vx, vy, vz: velocities in each axis

    Measurement vector (3D): ``[x, y, z]`` (position only)

    The nonlinear dynamics model includes gravity, quadratic air drag,
    Magnus effect, and ground bounce with restitution + friction.

    Process noise Q is **state-dependent**: larger when speed is higher.
    Measurement noise R is **adaptive**: scaled inversely with detection
    confidence so that low-confidence detections are down-weighted.

    Occlusions (frame-skips) are handled by predicting forward using
    physics while monotonically increasing the covariance to reflect
    growing uncertainty.
    """

    def __init__(self, dt: float = 1.0 / 30.0):
        self.dt = dt
        self.n = 6  # state dimension
        self.m = 3  # measurement dimension

        # State vector
        self.x = np.zeros(self.n, dtype=np.float64)

        # State covariance — position then velocity
        self.P = np.diag([
            100.0, 100.0, 50.0,    # position uncertainty
            50.0, 50.0, 25.0,       # velocity uncertainty
        ]).astype(np.float64)

        # Base process noise (scaled by dt and speed in predict)
        self._Q_base = np.diag([
            0.5, 0.5, 0.25,   # position process noise
            2.0, 2.0, 1.0,    # velocity process noise
        ]).astype(np.float64)

        # Measurement noise (pixel-level)
        self.R = np.diag([1.5, 1.5, 2.5]).astype(np.float64)

        # Measurement matrix (observe position only)
        self.H = np.zeros((self.m, self.n), dtype=np.float64)
        self.H[0, 0] = 1.0
        self.H[1, 1] = 1.0
        self.H[2, 2] = 1.0

        # Identity for Joseph-form update
        self._I = np.eye(self.n, dtype=np.float64)

        # Spin estimation (heuristic, rad/s)
        self._spin_rate: float = 0.0

        self.initialized: bool = False
        self.bounce_detected: bool = False

    # ------------------------------------------------------------------
    # Nonlinear state transition
    # ------------------------------------------------------------------

    def _state_transition(self, state: np.ndarray, dt: float) -> np.ndarray:
        """Nonlinear state transition with gravity, drag, and Magnus.

        Applies:
            1. Gravity to vz
            2. Quadratic air drag opposing motion
            3. Magnus effect if spin is estimated
            4. Position integration
            5. Ground bounce with restitution and friction
        """
        x, y, z, vx, vy, vz = state
        new_state = state.copy()
        dt = float(dt)

        # --- Gravity ---
        vz_new = vz - GRAVITY * dt

        # --- Quadratic air drag ---
        speed = np.sqrt(vx * vx + vy * vy + vz_new * vz_new)
        if speed > 1e-8:
            drag_factor = 1.0 - AIR_DRAG * speed * dt
            drag_factor = max(drag_factor, 0.8)  # cap drag to avoid sign flip
            vx *= drag_factor
            vy *= drag_factor
            vz_new *= drag_factor

        # --- Magnus effect (spin-induced lateral force) ---
        if speed > 5.0 and self._spin_rate > 0:
            magnus_force = MAGNUS_COEFF * self._spin_rate * speed
            # Lateral deflection perpendicular to travel direction
            inv_speed = 1.0 / speed
            perp_x = -vy * inv_speed
            perp_y = vx * inv_speed
            vx += magnus_force * perp_x * dt
            vy += magnus_force * perp_y * dt

        # --- Position integration ---
        new_state[0] = x + vx * dt
        new_state[1] = y + vy * dt
        new_state[2] = z + vz_new * dt - 0.5 * GRAVITY * dt * dt

        # --- Velocity update ---
        new_state[3] = vx
        new_state[4] = vy
        new_state[5] = vz_new

        # --- Bounce detection (ground plane at z = 0) ---
        self.bounce_detected = False
        if new_state[2] < 0:
            new_state[2] = abs(new_state[2]) * RESTITUTION
            new_state[5] = abs(new_state[5]) * (1.0 - FRICTION)
            new_state[3] *= (1.0 - FRICTION * 0.3)
            new_state[4] *= (1.0 - FRICTION * 0.1)
            self.bounce_detected = True

        return new_state

    # ------------------------------------------------------------------
    # Jacobian of state transition
    # ------------------------------------------------------------------

    def _jacobian_F(self, state: np.ndarray, dt: float) -> np.ndarray:
        """Compute Jacobian of state transition w.r.t. state.

        Returns a 6x6 matrix of partial derivatives.
        """
        x, y, z, vx, vy, vz = state
        dt = float(dt)

        speed = np.sqrt(vx * vx + vy * vy + vz * vz)
        F = np.zeros((self.n, self.n), dtype=np.float64)

        if speed > 1e-8:
            inv_speed = 1.0 / speed
            drag_factor = max(1.0 - AIR_DRAG * speed * dt, 0.8)

            # Partial derivatives of speed w.r.t. velocities
            ds_dvx = vx * inv_speed
            ds_dvy = vy * inv_speed
            ds_dvz = vz * inv_speed

            # Drag derivative w.r.t. each velocity component:
            #   d/d(vi)[vi * drag_factor] = drag_factor + vi * d(drag_factor)/d(vi)
            #   d(drag_factor)/d(vi) = -AIR_DRAG * dt * ds/d(vi)
            dd = -AIR_DRAG * dt  # common factor

            F[3, 3] = drag_factor + vx * dd * ds_dvx
            F[3, 4] = vx * dd * ds_dvy
            F[3, 5] = vx * dd * ds_dvz

            F[4, 3] = vy * dd * ds_dvx
            F[4, 4] = drag_factor + vy * dd * ds_dvy
            F[4, 5] = vy * dd * ds_dvz

            F[5, 3] = vz * dd * ds_dvx
            F[5, 4] = vz * dd * ds_dvy
            F[5, 5] = drag_factor + vz * dd * ds_dvz
        else:
            # No drag contribution when stationary
            np.fill_diagonal(F[3:, 3:], 1.0)

        # Magnus effect Jacobian contribution
        if speed > 5.0 and self._spin_rate > 0:
            inv_speed = 1.0 / speed
            magnus_dt = MAGNUS_COEFF * self._spin_rate * dt

            # F_vx = -vy/s, F_vy = vx/s
            # d(F_vx)/dvx = vy*vx/s^3, d(F_vx)/dvy = -1/s + vy^2/s^3
            # d(F_vy)/dvx = 1/s - vx^2/s^3, d(F_vy)/dvy = -vx*vy/s^3
            s2 = speed * speed
            s3 = s2 * speed

            F[3, 3] += magnus_dt * vy * vx / s3
            F[3, 4] += magnus_dt * (-inv_speed + vy * vy / s3)
            F[4, 3] += magnus_dt * (inv_speed - vx * vx / s3)
            F[4, 4] += magnus_dt * (-vx * vy / s3)

        # Position derivatives: dx/dvx = dt, etc.
        F[0, 3] = dt
        F[1, 4] = dt
        F[2, 5] = dt

        # Identity on diagonal for positions (no self-coupling)
        F[0, 0] = 1.0
        F[1, 1] = 1.0
        F[2, 2] = 1.0

        return F

    # ------------------------------------------------------------------
    # State-dependent process noise
    # ------------------------------------------------------------------

    def _compute_Q(self, state: np.ndarray, dt: float) -> np.ndarray:
        """Compute process noise scaled by speed and dt.

        Higher speed → more process noise (greater model uncertainty).
        """
        speed = np.sqrt(state[3] ** 2 + state[4] ** 2 + state[5] ** 2)
        # Scale factor: base multiplier increases with speed
        speed_factor = 1.0 + 0.05 * speed
        return self._Q_base * dt * speed_factor

    # ------------------------------------------------------------------
    # EKF predict step
    # ------------------------------------------------------------------

    def predict(self, dt: Optional[float] = None) -> None:
        """EKF predict step using Jacobian linearization.

        Args:
            dt: Time step override.  If *None*, uses ``self.dt``.
                 If dt > 3 * self.dt, the filter treats it as a
                 potential occlusion and inflates P accordingly.
        """
        if not self.initialized:
            return

        if dt is None:
            dt = self.dt

        dt = float(dt)
        if dt <= 0:
            logger.warning("EKF predict called with dt=%.4f <= 0; skipping", dt)
            return

        # Occlusion detection: large dt → inflate uncertainty
        if dt > 3.0 * self.dt:
            inflate = 1.0 + 0.2 * (dt / self.dt - 3.0)
            self.P *= inflate
            logger.debug(
                "EKF occlusion detected (dt=%.4f > 3*normal_dt); "
                "P inflated by %.2f",
                dt, inflate,
            )

        # Nonlinear state prediction
        self.x = self._state_transition(self.x, dt)

        # Jacobian linearization
        F = self._jacobian_F(self.x, dt)

        # State-dependent process noise
        Q = self._compute_Q(self.x, dt)

        # Covariance prediction: P = F @ P @ F^T + Q
        self.P = F @ self.P @ F.T + Q

        # Enforce symmetry and positive semi-definiteness
        self.P = (self.P + self.P.T) * 0.5
        eigvals = np.linalg.eigvalsh(self.P)
        if np.min(eigvals) < 0:
            logger.debug("EKF P has negative eigenvalues; clamping")
            eigvals = np.maximum(eigvals, 1e-6)
            eigvecs = np.linalg.eigh(self.P)[1]
            self.P = eigvecs @ np.diag(eigvals) @ eigvecs.T

    # ------------------------------------------------------------------
    # EKF update step
    # ------------------------------------------------------------------

    def update(self, z: np.ndarray, confidence: float = 1.0) -> None:
        """EKF update step with adaptive measurement noise.

        Args:
            z: Measurement vector ``[x, y, z]`` (use z=0 for 2D projection).
            confidence: Detection confidence in [0, 1].  Low confidence
                scales R upward so that the filter trusts the model more.
        """
        z = np.asarray(z, dtype=np.float64).ravel()

        if not self.initialized:
            self.x[:3] = z
            self.initialized = True
            logger.debug("EKF initialised with measurement z=%s", z)
            return

        # Clamp confidence to valid range
        confidence = float(np.clip(confidence, 0.05, 1.0))

        # Adaptive R: scale inversely with confidence
        R_scaled = self.R / confidence

        # Innovation (measurement residual)
        innov = z - self.H @ self.x

        # Innovation covariance
        S = self.H @ self.P @ self.H.T + R_scaled

        # Kalman gain
        try:
            S_inv = np.linalg.inv(S)
        except np.linalg.LinAlgError:
            # Regularise S if singular
            S += np.eye(self.m, dtype=np.float64) * 1e-6
            S_inv = np.linalg.inv(S)

        K = self.P @ self.H.T @ S_inv

        # State update
        self.x = self.x + K @ innov

        # Covariance update — Joseph form for numerical stability:
        # P = (I - K @ H) @ P @ (I - K @ H)^T + K @ R @ K^T
        I_KH = self._I - K @ self.H
        self.P = I_KH @ self.P @ I_KH.T + K @ R_scaled @ K.T

        # Enforce symmetry
        self.P = (self.P + self.P.T) * 0.5

        # Heuristic spin estimation from lateral velocity
        horiz_speed = np.sqrt(self.x[3] ** 2 + self.x[4] ** 2)
        if horiz_speed > 10.0:
            lateral_v = abs(self.x[3])
            self._spin_rate = min(lateral_v / BALL_RADIUS_M * 0.1, 50.0)

    # ------------------------------------------------------------------
    # Future trajectory prediction
    # ------------------------------------------------------------------

    def predict_future(self, n_steps: int = 20) -> List[dict]:
        """Predict the future trajectory for *n_steps*.

        Uses a copy of the current state so the filter state is not
        modified.

        Returns:
            List of dicts with keys ``x``, ``y``, ``z``, ``bounce``.
        """
        state = self.x.copy()
        trajectory: List[dict] = []
        dt = self.dt

        for _ in range(n_steps):
            old_z = state[2]
            state = self._state_transition(state, dt)

            # Bounce heuristic
            bounced = (
                (old_z >= 0 and state[2] >= 0 and abs(state[2] - old_z) > 0.01)
                or state[2] < 0.01
            )

            trajectory.append({
                "x": float(state[0]),
                "y": float(state[1]),
                "z": float(state[2]),
                "bounce": bounced,
            })

            if state[2] < -1.0:
                break

        return trajectory

    # ------------------------------------------------------------------
    # Occlusion handling
    # ------------------------------------------------------------------

    def handle_occlusion(self, missed_frames: int) -> None:
        """Handle a run of missed detections (occlusion).

        For each missed frame the filter predicts forward using the
        physics model and progressively inflates the covariance to
        reflect growing uncertainty.

        Args:
            missed_frames: Number of consecutive frames without a detection.
        """
        if missed_frames <= 0:
            return

        for i in range(1, missed_frames + 1):
            self.predict()
            # Grow P beyond the normal predict inflation
            growth = 1.0 + 0.1 * missed_frames
            self.P *= growth

        logger.debug(
            "EKF handled occlusion: %d missed frames, "
            "P diag=%s",
            missed_frames,
            np.diag(self.P).tolist(),
        )

    # ------------------------------------------------------------------
    # State accessors
    # ------------------------------------------------------------------

    def get_state(self) -> np.ndarray:
        """Return a copy of the current state vector."""
        return self.x.copy()

    def get_state_as_ekf(self, timestamp: float = 0.0, frame_number: int = 0) -> EKFState:
        """Return current state as an :class:`EKFState` dataclass."""
        return EKFState(
            x=float(self.x[0]),
            y=float(self.x[1]),
            z=float(self.x[2]),
            vx=float(self.x[3]),
            vy=float(self.x[4]),
            vz=float(self.x[5]),
            timestamp=timestamp,
            frame_number=frame_number,
        )

    def reset(self) -> None:
        """Reset the filter to its initial state."""
        self.x = np.zeros(self.n, dtype=np.float64)
        self.P = np.diag([100.0, 100.0, 50.0, 50.0, 50.0, 25.0]).astype(np.float64)
        self.initialized = False
        self.bounce_detected = False
        self._spin_rate = 0.0


# ======================================================================
# Sub-pixel refinement
# ======================================================================

class SubPixelRefiner:
    """Refine ball centroid detections to sub-pixel accuracy.

    Uses three complementary methods and returns the result from the
    most confident one:

        1. **OpenCV ``cornerSubPix``** — iterative Lucas-Kanade
           refinement on the ball region.
        2. **Spatial moments** — ``cv2.moments`` on a thresholded
           ball mask yields a sub-pixel centroid.
        3. **Gradient-weighted centroid** — intensity values within
           the ball disk are used as weights.

    Args:
        half_win: Half-window size for the refinement region.
        criteria: Termination criteria for ``cornerSubPix``.
    """

    def __init__(
        self,
        half_win: int = 5,
        criteria: tuple = None,
    ):
        self.half_win = half_win
        self.criteria = criteria or (
            cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.01
        )

    def refine(
        self,
        frame: np.ndarray,
        cx: int,
        cy: int,
        radius: float,
        frame_number: int = 0,
        timestamp: float = 0.0,
    ) -> SubPixelDetection:
        """Refine a ball detection to sub-pixel accuracy.

        Args:
            frame: BGR image (H x W x 3).
            cx, cy: Integer pixel centroid from the detector.
            radius: Estimated ball radius in pixels.
            frame_number: Frame index (for the result).
            timestamp: Timestamp in seconds (for the result).

        Returns:
            :class:`SubPixelDetection` with refined coordinates and the
            best available confidence.
        """
        h, w = frame.shape[:2]

        # Clamp the region to image bounds
        hw = self.half_win
        x0 = max(int(cx) - hw, 0)
        y0 = max(int(cy) - hw, 0)
        x1 = min(int(cx) + hw + 1, w)
        y1 = min(int(cy) + hw + 1, h)

        if x1 <= x0 or y1 <= y0:
            # Degenerate region — return the integer detection
            return SubPixelDetection(
                x=float(cx), y=float(cy),
                radius=radius, confidence=0.3,
                frame_number=frame_number, timestamp=timestamp,
            )

        # Convert to grayscale for refinement methods
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # --- Method 1: cornerSubPix ---
        result_csp = self._corner_subpix(gray, cx, cy)

        # --- Method 2: spatial moments ---
        ball_mask = self._create_ball_mask(gray, cx, cy, radius)
        result_mom = self._moment_centroid(ball_mask)

        # --- Method 3: gradient-weighted centroid ---
        result_grad = self._gradient_weighted_centroid(gray, cx, cy, radius)

        # Pick the best result (prefer methods that succeeded)
        candidates: List[Tuple[Optional[Tuple[float, float]], float]] = []

        if result_csp is not None:
            candidates.append((result_csp, 0.95))
        if result_mom is not None:
            candidates.append((result_mom, 0.85))
        if result_grad is not None:
            candidates.append((result_grad, 0.80))

        if candidates:
            best_pt, best_conf = max(candidates, key=lambda c: c[1])
            return SubPixelDetection(
                x=best_pt[0], y=best_pt[1],
                radius=radius, confidence=best_conf,
                frame_number=frame_number, timestamp=timestamp,
            )

        # All methods failed — fall back to integer coordinates
        return SubPixelDetection(
            x=float(cx), y=float(cy),
            radius=radius, confidence=0.3,
            frame_number=frame_number, timestamp=timestamp,
        )

    # ------------------------------------------------------------------
    # Internal methods
    # ------------------------------------------------------------------

    def _create_ball_mask(
        self,
        gray: np.ndarray,
        cx: int,
        cy: int,
        radius: float,
    ) -> np.ndarray:
        """Create a binary mask for the ball region."""
        h, w = gray.shape
        r = max(int(radius), 2)
        y0 = max(cy - r, 0)
        y1 = min(cy + r + 1, h)
        x0 = max(cx - r, 0)
        x1 = min(cx + r + 1, w)

        roi = gray[y0:y1, x0:x1].copy()
        if roi.size == 0:
            return np.zeros((h, w), dtype=np.uint8)

        # Adaptive thresholding within the ball region
        blurred = cv2.GaussianBlur(roi, (3, 3), 0)
        _, mask_roi = cv2.threshold(
            blurred, 0, 255,
            cv2.THRESH_BINARY + cv2.THRESH_OTSU,
        )

        # Circular mask constraint
        yy, xx = np.ogrid[:roi.shape[0], :roi.shape[1]]
        dist = np.sqrt((xx - r) ** 2 + (yy - r) ** 2)
        circular = dist <= r
        mask_roi = mask_roi * circular.astype(np.uint8)

        mask = np.zeros((h, w), dtype=np.uint8)
        mask[y0:y1, x0:x1] = mask_roi
        return mask

    def _corner_subpix(
        self,
        gray: np.ndarray,
        cx: int,
        cy: int,
    ) -> Optional[Tuple[float, float]]:
        """Use OpenCV's ``cornerSubPix`` for sub-pixel refinement."""
        h, w = gray.shape
        hw = self.half_win

        x0 = max(cx - hw, 0)
        y0 = max(cy - hw, 0)
        x1 = min(cx + hw + 1, w)
        y1 = min(cy + hw + 1, h)

        if x1 - x0 < 3 or y1 - y0 < 3:
            return None

        try:
            roi = gray[y0:y1, x0:x1]
            # cornerSubPix requires float32 image and float64 points
            roi32 = roi.astype(np.float32)
            pt = np.array([[[cx - x0, cy - y0]]], dtype=np.float32)

            cv2.cornerSubPix(
                roi32, pt,
                winSize=(hw, hw),
                zeroZone=(-1, -1),
                criteria=self.criteria,
            )

            sub_x = float(pt[0, 0, 0]) + x0
            sub_y = float(pt[0, 0, 1]) + y0

            # Sanity check: result must be within the search window
            if abs(sub_x - cx) > hw or abs(sub_y - cy) > hw:
                return None

            return (sub_x, sub_y)
        except cv2.error:
            return None

    def _moment_centroid(
        self,
        ball_mask: np.ndarray,
    ) -> Optional[Tuple[float, float]]:
        """Use image moments for sub-pixel centroid."""
        moments = cv2.moments(ball_mask, binaryImage=True)

        if moments["m00"] < 1.0:
            return None

        cx = moments["m10"] / moments["m00"]
        cy = moments["m01"] / moments["m00"]
        return (float(cx), float(cy))

    def _gradient_weighted_centroid(
        self,
        gray: np.ndarray,
        cx: int,
        cy: int,
        radius: float,
    ) -> Optional[Tuple[float, float]]:
        """Weighted centroid using intensity gradient within ball region.

        Pixels closer to the estimated centre are weighted more heavily,
        and their intensity is used to bias the centroid towards the
        brighter (higher-contrast) part of the ball.
        """
        h, w = gray.shape
        r = max(int(radius), 2)
        x0 = max(cx - r, 0)
        y0 = max(cy - r, 0)
        x1 = min(cx + r + 1, w)
        y1 = min(cy + r + 1, h)

        if x1 <= x0 or y1 <= y0:
            return None

        roi = gray[y0:y1, x0:x1].astype(np.float64)

        # Create spatial weight: Gaussian-like centred on the ball
        yy, xx = np.mgrid[:roi.shape[0], :roi.shape[1]]
        centre_y = roi.shape[0] / 2.0
        centre_x = roi.shape[1] / 2.0
        dist_sq = (xx - centre_x) ** 2 + (yy - centre_y) ** 2
        sigma = max(r / 2.0, 1.0)
        spatial_w = np.exp(-dist_sq / (2.0 * sigma * sigma))

        # Circular mask
        dist = np.sqrt(dist_sq)
        circular = (dist <= r).astype(np.float64)
        weights = spatial_w * circular

        # Normalise ROI intensity to [0, 1]
        roi_min = roi.min()
        roi_max = roi.max()
        if roi_max - roi_min < 1e-8:
            return None
        roi_norm = (roi - roi_min) / (roi_max - roi_min)

        # Combined weight: spatial * intensity
        combined = weights * (roi_norm + 0.1)

        total_w = combined.sum()
        if total_w < 1e-8:
            return None

        dx = (combined * xx).sum() / total_w + x0
        dy = (combined * yy).sum() / total_w + y0

        # Sanity check
        if abs(dx - cx) > r or abs(dy - cy) > r:
            return None

        return (float(dx), float(dy))


# ======================================================================
# Helper functions
# ======================================================================

def refine_detections_subpixel(
    frame: np.ndarray,
    detections: list,
    refiner: SubPixelRefiner,
) -> List[SubPixelDetection]:
    """Refine all detections in a frame to sub-pixel accuracy.

    Batch-processes detections by extracting the relevant image regions
    and running the refiner on each one.

    Args:
        frame: BGR image (H x W x 3).
        detections: List of ``BallDetection`` objects (from
            :class:`~app.core.ball_detector.BallDetection`).
        refiner: A :class:`SubPixelRefiner` instance.

    Returns:
        List of :class:`SubPixelDetection` with refined coordinates.
    """
    if not detections:
        return []

    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    results: List[SubPixelDetection] = []

    for det in detections:
        cx = int(det.x)
        cy = int(det.y)
        radius = float(det.radius)

        # Guard against out-of-bounds detections
        h, w = frame.shape[:2]
        hw = refiner.half_win
        if cx < hw or cx >= w - hw or cy < hw or cy >= h - hw:
            # Out of safe zone — return the raw detection
            results.append(SubPixelDetection(
                x=float(cx), y=float(cy),
                radius=radius, confidence=float(det.confidence) * 0.5,
                frame_number=det.frame_number,
                timestamp=det.timestamp,
            ))
            continue

        refined = refiner.refine(
            frame, cx, cy, radius,
            frame_number=det.frame_number,
            timestamp=det.timestamp,
        )
        results.append(refined)

    return results


def smooth_trajectory_ekf(
    points: List[Tuple[float, float, int, float]],
    dt: float = 1.0 / 30.0,
) -> List[Tuple[float, float, float, float]]:
    """Smooth a trajectory using the Extended Kalman Filter.

    Args:
        points: List of ``(x, y, frame_number, timestamp)`` tuples.
        dt: Nominal time step between frames (seconds).

    Returns:
        List of ``(x, y, frame_number, timestamp)`` tuples with
        smoothed coordinates.  The output length equals the input
        length.  Uses NumPy vectorised operations throughout.
    """
    if not points:
        return []

    n = len(points)
    if n < 2:
        return [(p[0], p[1], p[2], p[3]) for p in points]

    # Convert to NumPy arrays for vectorised processing
    arr = np.array(points, dtype=np.float64)  # shape (N, 4)
    xs = arr[:, 0]
    ys = arr[:, 1]
    frames = arr[:, 2]
    timestamps = arr[:, 3]

    # Initialise EKF
    ekf = ExtendedKalmanFilter(dt=dt)

    # First point: initialise the filter
    ekf.x[:2] = arr[0, :2]
    ekf.x[2] = 0.0  # z = 0 for 2D projection
    # Estimate initial velocity from first two points if available
    if n >= 2:
        dt01 = timestamps[1] - timestamps[0]
        if dt01 > 1e-8:
            ekf.x[3] = (xs[1] - xs[0]) / dt01
            ekf.x[4] = (ys[1] - ys[0]) / dt01
    ekf.initialized = True

    smoothed: List[Tuple[float, float, float, float]] = []

    for i in range(n):
        if i > 0:
            # Compute actual dt from timestamps
            actual_dt = timestamps[i] - timestamps[i - 1]
            if actual_dt <= 0:
                actual_dt = dt

            ekf.predict(dt=actual_dt)

        # Update with measurement (z=0 for 2D projection)
        z = np.array([xs[i], ys[i], 0.0], dtype=np.float64)
        ekf.update(z, confidence=1.0)

        state = ekf.get_state()
        smoothed.append((
            float(state[0]),
            float(state[1]),
            float(frames[i]),
            float(timestamps[i]),
        ))

    logger.debug(
        "EKF trajectory smoothing: %d input points → %d output points",
        n, len(smoothed),
    )
    return smoothed
