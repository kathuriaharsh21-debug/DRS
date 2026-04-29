"""
Pydantic schemas for API request/response serialisation.
"""

from typing import Optional, List
from pydantic import BaseModel, Field
from enum import Enum
from datetime import datetime


# ======================================================================
# Enums
# ======================================================================

class BallType(str, Enum):
    RED = "red"
    WHITE = "white"
    PINK = "pink"


class AnalysisStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


# ======================================================================
# Trajectory & Detection
# ======================================================================

class TrajectoryPointSchema(BaseModel):
    """A single point on the estimated ball trajectory."""
    x: float = Field(..., description="Normalised x [0, 1]")
    y: float = Field(..., description="Normalised y [0, 1]")
    z: float = Field(0.0, description="Estimated height [0, 1]")
    frame_number: int = Field(..., description="Frame index")
    timestamp: float = Field(..., description="Timestamp in seconds")


class BallPositionSchema(BaseModel):
    """Detected ball position for one frame."""
    x: int
    y: int
    radius: float
    confidence: float
    frame_number: int
    timestamp: float


class FrameDataSchema(BaseModel):
    """Per-frame analysis data returned to the frontend."""
    frame_number: int
    timestamp: float
    ball_detected: bool = False
    ball_position: Optional[BallPositionSchema] = None
    trajectory_path: List[TrajectoryPointSchema] = Field(default_factory=list)
    annotated_frame_b64: Optional[str] = Field(
        None, description="Base64-encoded JPEG of the annotated frame"
    )


# ======================================================================
# Decision
# ======================================================================

class DecisionResponse(BaseModel):
    """Umpire decision result."""
    decision: str = Field(..., description="OUT or NOT OUT")
    dismissal_type: str = Field(..., description="LBW, BOWLED, WIDE, NO_BALL, NOT_OUT")
    confidence: float = Field(..., ge=0.0, le=1.0)
    reason: str
    ball_speed_kmh: float
    pitch_point: Optional[dict] = None
    impact_point: Optional[dict] = None
    trajectory: Optional[dict] = None


# ======================================================================
# Pitch calibration
# ======================================================================

class PitchCalibrationSchema(BaseModel):
    """Four corner points for perspective calibration."""
    top_left: List[int] = Field(..., min_length=2, max_length=2)
    top_right: List[int] = Field(..., min_length=2, max_length=2)
    bottom_left: List[int] = Field(..., min_length=2, max_length=2)
    bottom_right: List[int] = Field(..., min_length=2, max_length=2)


# ======================================================================
# Video upload
# ======================================================================

class VideoInfo(BaseModel):
    """Metadata for an uploaded video."""
    video_id: str
    filename: str
    file_size: int
    uploaded_at: datetime
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[float] = None
    frame_count: Optional[int] = None
    duration: Optional[float] = None


class VideoUploadResponse(BaseModel):
    """Response returned after a successful video upload."""
    success: bool = True
    video_id: str
    filename: str
    file_size: int
    message: str = "Video uploaded successfully"


class VideoListResponse(BaseModel):
    """Response listing all uploaded videos."""
    videos: List[VideoInfo]
    total: int


# ======================================================================
# Analysis
# ======================================================================

class AnalysisRequest(BaseModel):
    """Request body for starting video analysis."""
    ball_type: BallType = BallType.RED
    frame_skip: int = Field(2, ge=1, le=10, description="Process every Nth frame")
    auto_calibrate: bool = Field(True, description="Attempt automatic pitch calibration")
    calibration: Optional[PitchCalibrationSchema] = Field(
        None, description="Manual pitch calibration (overrides auto)"
    )


class AnalysisStatusResponse(BaseModel):
    """Progress / status of an analysis job."""
    job_id: str
    video_id: str
    status: AnalysisStatus
    progress: float = Field(0.0, ge=0.0, le=1.0)
    frames_processed: int = 0
    total_frames: int = 0
    message: str = ""
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error: Optional[str] = None


class AnalysisResultResponse(BaseModel):
    """Complete analysis result."""
    job_id: str
    video_id: str
    status: AnalysisStatus
    decision: Optional[DecisionResponse] = None
    trajectory: List[TrajectoryPointSchema] = Field(default_factory=list)
    total_frames: int = 0
    frames_with_ball: int = 0
    ball_type: str = "red"
    ball_speed_kmh: float = 0.0
    deviation_degrees: float = 0.0
    predicted_stump_hit: bool = False
    confidence: float = 0.0
    processing_time: Optional[float] = Field(None, description="Seconds to process")
    annotated_video_path: Optional[str] = None
    # v3: Post-release trajectory fields
    normalised_prediction: List[dict] = Field(default_factory=list, description="Normalised prediction path (0-1)")
    release_frame: Optional[int] = Field(None, description="Frame where ball was released from bowler")
    impact_frame: Optional[int] = Field(None, description="Frame where ball hit batsman pad")
    pitch_point: Optional[dict] = Field(None, description="Normalised pitch point {x, y}")
    impact_point: Optional[dict] = Field(None, description="Normalised impact point {x, y}")


class FrameDataListResponse(BaseModel):
    """Paginated frame data."""
    job_id: str
    frame_data: List[FrameDataSchema]
    total_frames: int
    returned_frames: int
    offset: int = 0
    limit: int = 100
