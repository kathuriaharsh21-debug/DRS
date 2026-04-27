"""
Configuration management for Umpire AI Backend.

Uses pydantic-settings for environment variable loading with .env file support.
All settings have sensible defaults for development.
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

    # Ball detection parameters
    ball_type: str = "red"  # "red", "white", or "pink"
    ball_min_radius: int = 3
    ball_max_radius: int = 25
    detection_confidence: float = 0.6

    # Cricket pitch dimensions (in meters — ICC standard)
    pitch_length: float = 20.12   # 22 yards
    pitch_width: float = 3.05     # 10 feet
    crease_length: float = 1.22   # 4 feet (popping crease)
    stumps_height: float = 0.71   # 28 inches
    stumps_width: float = 0.23    # 9 inches (total across 3 stumps)

    # Video processing parameters
    fps_target: int = 30
    frame_skip: int = 2           # Process every Nth frame for speed

    # Tracker parameters
    tracker_max_distance: float = 100.0
    tracker_max_missing_frames: int = 10

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


# Singleton settings instance
def get_settings() -> Settings:
    """Return the global Settings singleton."""
    return Settings()
