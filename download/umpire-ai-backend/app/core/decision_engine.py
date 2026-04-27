"""
Cricket decision engine.

Implements the rules for LBW, Bowled, No-ball, and Wide decisions based
on the trajectory data produced by the analysis pipeline.  Rules follow
the ICC Standard Playing Conditions where applicable.
"""

import numpy as np
from typing import Optional, List
from dataclasses import dataclass
from enum import Enum


# ======================================================================
# Enums
# ======================================================================

class Decision(str, Enum):
    """Overall umpire decision."""
    OUT = "OUT"
    NOT_OUT = "NOT OUT"


class DismissalType(str, Enum):
    """Specific type of dismissal (or signal)."""
    LBW = "LBW"
    BOWLED = "BOWLED"
    CAUGHT_BEHIND = "CAUGHT_BEHIND"
    NOT_OUT = "NOT_OUT"
    NO_BALL = "NO_BALL"
    WIDE = "WIDE"


# ======================================================================
# Result data
# ======================================================================

@dataclass
class DecisionResult:
    """Complete decision produced by the engine.

    Attributes:
        decision: Overall OUT / NOT OUT verdict.
        dismissal_type: Specific dismissal type.
        confidence: Confidence score in [0, 1].
        reason: Human-readable explanation.
        ball_speed_kmh: Estimated ball speed in km/h.
        pitch_point: Normalised (x, y) of where the ball pitched.
        impact_point: Normalised (x, y) of impact.
        trajectory: Extra trajectory metadata.
    """
    decision: Decision
    dismissal_type: DismissalType
    confidence: float
    reason: str
    ball_speed_kmh: float
    pitch_point: Optional[dict] = None
    impact_point: Optional[dict] = None
    trajectory: Optional[dict] = None

    def to_dict(self) -> dict:
        """Serialise to a plain dictionary."""
        return {
            "decision": self.decision.value,
            "dismissal_type": self.dismissal_type.value,
            "confidence": round(self.confidence, 3),
            "reason": self.reason,
            "ball_speed_kmh": round(self.ball_speed_kmh, 1),
            "pitch_point": self.pitch_point,
            "impact_point": self.impact_point,
            "trajectory": self.trajectory,
        }


# ======================================================================
# Engine
# ======================================================================

class DecisionEngine:
    """Analyses trajectory data and produces cricket decisions.

    Decision priority order:

    1. **No-ball** — overrides everything (free hit).
    2. **Wide** — delivery is outside the playable zone.
    3. **Bowled** — ball hits stumps directly.
    4. **LBW** — three-condition check (pitch, impact, would-hit).
    5. **Not Out** — default when no dismissal criteria are met.

    All coordinates are expected in **normalised** pitch space
    (``[0, 1]`` on each axis) with the origin at the top-left.
    """

    # Stump zone boundaries (normalised x)
    STUMP_LEFT: float = 0.45
    STUMP_RIGHT: float = 0.55

    # Key stumps for LBW geometry
    OFF_STUMP: float = 0.52
    LEG_STUMP: float = 0.48

    # Wide threshold — ball centre beyond this from 0.5 is a wide
    WIDE_MARGIN: float = 0.65

    def analyze(self, trajectory_data: dict, frame_shape: tuple) -> DecisionResult:
        """Run the full decision pipeline.

        Args:
            trajectory_data: Dictionary produced by
                :class:`TrajectoryEstimator` containing keys such as
                ``ball_speed_mps``, ``predicted_stump_hit``,
                ``deviation_degrees``, ``pitch_x``, ``impact_x``, etc.
            frame_shape: ``(height, width)`` of the source frame (unused
                but kept for API consistency).

        Returns:
            A :class:`DecisionResult` with the verdict.
        """
        ball_speed_mps = trajectory_data.get("ball_speed_mps", 0.0)
        ball_speed_kmh = ball_speed_mps * 3.6

        # --- 1. No-ball ---
        if trajectory_data.get("no_ball", False):
            return DecisionResult(
                decision=Decision.NOT_OUT,
                dismissal_type=DismissalType.NO_BALL,
                confidence=0.85,
                reason=(
                    "Bowler's front foot exceeded the popping crease line "
                    "during delivery.  Free hit awarded to batting side."
                ),
                ball_speed_kmh=ball_speed_kmh,
            )

        # --- 2. Wide ---
        if self._is_wide(trajectory_data):
            return DecisionResult(
                decision=Decision.NOT_OUT,
                dismissal_type=DismissalType.WIDE,
                confidence=0.80,
                reason=(
                    "Ball delivered too wide of the batsman for a "
                    "reasonable shot to be played.  One run penalty "
                    "awarded to batting side."
                ),
                ball_speed_kmh=ball_speed_kmh,
            )

        # --- 3. Bowled ---
        if self._is_bowled(trajectory_data):
            return DecisionResult(
                decision=Decision.OUT,
                dismissal_type=DismissalType.BOWLED,
                confidence=0.95,
                reason=(
                    "Ball struck and dislodged the bails directly at the "
                    "striker's end.  No contact with bat or batsman's "
                    "body before hitting stumps."
                ),
                ball_speed_kmh=ball_speed_kmh,
            )

        # --- 4. LBW ---
        lbw_result = self._check_lbw(trajectory_data)
        if lbw_result is not None:
            return lbw_result

        # --- 5. Default: Not Out ---
        return DecisionResult(
            decision=Decision.NOT_OUT,
            dismissal_type=DismissalType.NOT_OUT,
            confidence=0.75,
            reason=(
                "Insufficient evidence to uphold the appeal.  The ball "
                "trajectory does not satisfy the conditions for the "
                "dismissal being reviewed."
            ),
            ball_speed_kmh=ball_speed_kmh,
        )

    # ------------------------------------------------------------------
    # Rule checks
    # ------------------------------------------------------------------

    def _is_wide(self, data: dict) -> bool:
        """Return ``True`` if the delivery qualifies as a Wide."""
        impact_x = data.get("impact_x", 0.5)
        predicted_x = data.get("predicted_stump_x", 0.5)
        if abs(impact_x - 0.5) > self.WIDE_MARGIN:
            return True
        if abs(predicted_x - 0.5) > self.WIDE_MARGIN:
            return True
        return False

    def _is_bowled(self, data: dict) -> bool:
        """Return ``True`` if the ball hit stumps directly (no pad
        contact first)."""
        hit_stumps = data.get("predicted_stump_hit", False)
        hit_pad = data.get("hit_pad", False)
        return hit_stumps and not hit_pad

    def _check_lbw(self, data: dict) -> Optional[DecisionResult]:
        """Evaluate all three LBW conditions.

        Returns ``None`` if the ball did not hit the pad (not an LBW
        appeal scenario), or a :class:`DecisionResult` otherwise.
        """
        if not data.get("hit_pad", False):
            return None

        pitch_x = data.get("pitch_x", 0.5)
        impact_x = data.get("impact_x", 0.5)
        would_hit = data.get("predicted_stump_hit", False)
        ball_speed_kmh = data.get("ball_speed_mps", 0.0) * 3.6

        # Condition 1: pitch in line or on leg side
        pitched_in_line = self.LEG_STUMP <= pitch_x <= self.OFF_STUMP + 0.1
        pitched_outside_off = pitch_x > self.OFF_STUMP + 0.1

        if not pitched_in_line and not pitched_outside_off:
            # Pitched too far outside leg stump
            return DecisionResult(
                decision=Decision.NOT_OUT,
                dismissal_type=DismissalType.NOT_OUT,
                confidence=0.80,
                reason=(
                    "Ball pitched outside the line of leg stump — "
                    "cannot be given out LBW regardless of impact."
                ),
                ball_speed_kmh=ball_speed_kmh,
                pitch_point={"x": pitch_x, "y": data.get("pitch_y", 0.5)},
                impact_point={"x": impact_x, "y": data.get("impact_y", 0.7)},
            )

        # Condition 2: impact in line with stumps
        impact_in_line = (
            self.LEG_STUMP - 0.05 <= impact_x <= self.OFF_STUMP + 0.15
        )

        # Condition 3: ball would go on to hit stumps
        if not would_hit:
            return DecisionResult(
                decision=Decision.NOT_OUT,
                dismissal_type=DismissalType.NOT_OUT,
                confidence=0.80,
                reason=(
                    f"Ball struck the pad but trajectory prediction indicates "
                    f"the ball would miss the stumps (predicted path: "
                    f"outside leg stump).  Pitch point: ({pitch_x:.2f}), "
                    f"Impact point: ({impact_x:.2f})."
                ),
                ball_speed_kmh=ball_speed_kmh,
                pitch_point={"x": pitch_x, "y": data.get("pitch_y", 0.5)},
                impact_point={"x": impact_x, "y": data.get("impact_y", 0.7)},
            )

        # Impact outside line but pitched outside off — not out unless
        # no shot was offered (we conservatively say not out)
        if not impact_in_line and pitched_outside_off:
            return DecisionResult(
                decision=Decision.NOT_OUT,
                dismissal_type=DismissalType.NOT_OUT,
                confidence=0.78,
                reason=(
                    "Ball pitched outside off stump and impact was outside "
                    "the line of stumps.  Batsman may be given out if no "
                    "genuine attempt to play was made."
                ),
                ball_speed_kmh=ball_speed_kmh,
            )

        # All three conditions met → OUT LBW
        confidence = 0.95 if (pitched_in_line and impact_in_line) else 0.88
        reason_parts = [
            "All three LBW conditions satisfied:",
            f"1) Ball pitched {'in line with' if pitched_in_line else 'outside off'} stumps",
            f"2) Impact was {'in line with' if impact_in_line else 'outside'} stumps",
            "3) Predicted trajectory shows ball would hit the stumps",
        ]

        return DecisionResult(
            decision=Decision.OUT,
            dismissal_type=DismissalType.LBW,
            confidence=confidence,
            reason=". ".join(reason_parts) + ".",
            ball_speed_kmh=ball_speed_kmh,
            pitch_point={"x": pitch_x, "y": data.get("pitch_y", 0.5)},
            impact_point={"x": impact_x, "y": data.get("impact_y", 0.7)},
            trajectory={
                "deviation": data.get("deviation_degrees", 0),
                "predicted_path": "HITTING" if would_hit else "MISSING",
            },
        )
