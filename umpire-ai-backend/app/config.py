"""
Configuration management for Umpire AI Backend — v2.

Extended with new parameters for the hybrid detection pipeline,
BoT-SORT tracking, UKF trajectory estimation, and model paths.
"""

from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    """Application settings loaded from environment variables and .env file."""

    # Application metadata
    app_name: str = "Umpire AI Backend"
    app_version: str = "2.0.0"
    debug: bool = True

    # Storage directories
    upload_dir: Path = Path("./uploads")
    output_dir: Path = Path("./output")

    # Upload constraints
    max_video_size: int = 500 * 1024 * 1024  # 500MB
    allowed_extensions: list = [".mp4", ".webm", ".mov", ".avi", ".mkv"]

    # ---- Detection parameters (v2 hybrid) ----
    detection_tier: str = "auto"     # "auto", "yolo", or "classical"
    yolo_model_path: str = "yolo11s_cricket_ball.pt"
    yolo_confidence: float = 0.35
    yolo_iou_threshold: float = 0.45
    yolo_imgsz: int = 1280           # inference resolution (higher = better for small balls)
    yolo_device: str = ""            # "" = auto, "0" = GPU, "cpu"

    # Classical fallback parameters
    ball_type: str = "red"           # "red", "white", or "pink"
    ball_min_radius: int = 3
    ball_max_radius: int = 25
    detection_confidence: float = 0.6

    # ---- Tracking parameters (v2) ----
    tracking_tier: str = "auto"      # "auto", "botsort", or "classical"
    tracker_max_distance: float = 120.0
    tracker_max_missing_frames: int = 15  # longer buffer for occlusion behind bowler

    # ---- Trajectory parameters (v2 UKF) ----
    use_ukf: bool = True             # Unscented Kalman Filter (nonlinear) vs linear KF
    ukf_alpha: float = 0.1           # UKF sigma point spread
    ukf_beta: float = 2.0            # UKF prior knowledge of distribution
    ukf_process_noise: float = 0.5   # Q scaling factor

    # ---- Physics model parameters ----
    gravity: float = 9.81            # m/s^2
    air_drag_coeff: float = 0.002    # simplified drag
    magnus_coeff: float = 0.001      # spin-induced lateral force
    restitution: float = 0.65        # bounce coefficient
    surface_friction: float = 0.4    # pitch friction

    # ---- Cricket pitch dimensions (ICC standard) ----
    pitch_length: float = 20.12      # 22 yards
    pitch_width: float = 3.05        # 10 feet
    crease_length: float = 1.22      # 4 feet (popping crease)
    stumps_height: float = 0.71      # 28 inches
    stumps_width: float = 0.23       # 9 inches total

    # ---- Video processing ----
    fps_target: int = 30
    frame_skip: int = 2              # Process every Nth frame for speed

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


def get_settings() -> Settings:
    """Return the global Settings singleton."""
    return Settings()
