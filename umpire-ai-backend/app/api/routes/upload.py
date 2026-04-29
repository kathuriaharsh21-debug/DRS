"""
Video upload API routes.

Provides endpoints for uploading cricket match videos and listing
previously uploaded videos.
"""

import uuid
import logging
from datetime import datetime
from pathlib import Path
from typing import List

from fastapi import APIRouter, UploadFile, File, HTTPException, Depends

from fastapi import BackgroundTasks

from app.config import get_settings, Settings
from app.utils.frame_utils import get_video_info
from app.models.schemas import (
    VideoUploadResponse,
    VideoListResponse,
    VideoInfo,
    AnalysisStatusResponse,
    AnalysisRequest,
    AnalysisStatus,
    BallType,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["upload"])

# In-memory video registry (production: replace with DB)
_video_registry: dict = {}


def _get_registry() -> dict:
    """Return the in-memory video registry."""
    return _video_registry


@router.post(
    "/upload",
    response_model=VideoUploadResponse,
    summary="Upload a cricket match video",
    responses={
        400: {"description": "Invalid file type or size exceeded"},
    },
)
async def upload_video(
    file: UploadFile = File(..., description="Video file (.mp4, .webm, .mov, .avi, .mkv)"),
    settings: Settings = Depends(get_settings),
) -> VideoUploadResponse:
    """Upload a video file for ball-trajectory analysis.

    The file is saved to the configured upload directory and assigned a
    unique ``video_id`` for subsequent analysis requests.
    """
    # Validate extension
    ext = Path(file.filename or "").suffix.lower()
    if ext not in settings.allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=(
                f"File type '{ext}' not allowed. "
                f"Accepted: {', '.join(settings.allowed_extensions)}"
            ),
        )

    # Read content
    content = await file.read()

    # Validate size
    if len(content) > settings.max_video_size:
        max_mb = settings.max_video_size / (1024 * 1024)
        raise HTTPException(
            status_code=400,
            detail=f"File size exceeds maximum of {max_mb:.0f} MB",
        )

    # Generate unique ID
    video_id = uuid.uuid4().hex[:12]

    # Save to disk
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)

    safe_filename = f"{video_id}{ext}"
    save_path = upload_dir / safe_filename

    with open(save_path, "wb") as f:
        f.write(content)

    logger.info("Video uploaded: %s (%d bytes) → %s", file.filename, len(content), save_path)

    # Extract metadata
    video_meta: dict = {"width": None, "height": None, "fps": None,
                        "frame_count": None, "duration": None}
    try:
        info = get_video_info(str(save_path))
        video_meta = info
    except Exception as exc:
        logger.warning("Could not read video metadata: %s", exc)

    # Register
    now = datetime.utcnow()
    entry = {
        "video_id": video_id,
        "filename": file.filename or safe_filename,
        "file_path": str(save_path),
        "file_size": len(content),
        "uploaded_at": now,
        **video_meta,
    }
    _video_registry[video_id] = entry

    return VideoUploadResponse(
        success=True,
        video_id=video_id,
        filename=file.filename or safe_filename,
        file_size=len(content),
        message="Video uploaded successfully",
    )


@router.get(
    "/videos",
    response_model=VideoListResponse,
    summary="List all uploaded videos",
)
async def list_videos() -> VideoListResponse:
    """Return a list of all previously uploaded videos with metadata."""
    videos: List[VideoInfo] = []
    for vid, entry in _video_registry.items():
        videos.append(VideoInfo(
            video_id=entry["video_id"],
            filename=entry["filename"],
            file_size=entry["file_size"],
            uploaded_at=entry["uploaded_at"],
            width=entry.get("width"),
            height=entry.get("height"),
            fps=entry.get("fps"),
            frame_count=entry.get("frame_count"),
            duration=entry.get("duration"),
        ))

    # Sort newest first
    videos.sort(key=lambda v: v.uploaded_at, reverse=True)

    return VideoListResponse(videos=videos, total=len(videos))


@router.get(
    "/videos/{video_id}",
    response_model=VideoInfo,
    summary="Get details for a specific video",
    responses={404: {"description": "Video not found"}},
)
async def get_video(video_id: str) -> VideoInfo:
    """Retrieve metadata for a single uploaded video."""
    entry = _video_registry.get(video_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Video not found")
    return VideoInfo(
        video_id=entry["video_id"],
        filename=entry["filename"],
        file_size=entry["file_size"],
        uploaded_at=entry["uploaded_at"],
        width=entry.get("width"),
        height=entry.get("height"),
        fps=entry.get("fps"),
        frame_count=entry.get("frame_count"),
        duration=entry.get("duration"),
    )


@router.delete(
    "/videos/{video_id}",
    summary="Delete an uploaded video",
    responses={404: {"description": "Video not found"}},
)
async def delete_video(video_id: str) -> dict:
    """Delete an uploaded video from disk and the registry."""
    entry = _video_registry.get(video_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Video not found")

    file_path = Path(entry.get("file_path", ""))
    if file_path.exists():
        file_path.unlink()

    del _video_registry[video_id]
    return {"success": True, "message": f"Video {video_id} deleted"}


@router.post(
    "/upload-and-analyze",
    response_model=AnalysisStatusResponse,
    summary="Upload video and immediately start analysis",
    responses={400: {"description": "Invalid file type or size exceeded"}},
)
async def upload_and_analyze(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="Video file (.mp4, .webm, .mov, .avi, .mkv)"),
    ball_type: str = "red",
    frame_skip: int = 2,
    auto_calibrate: bool = True,
    settings: Settings = Depends(get_settings),
) -> AnalysisStatusResponse:
    """Upload a video and immediately queue it for ball-trajectory analysis.

    This is a convenience endpoint that combines ``/api/upload`` and
    ``/api/analyze/{video_id}`` in a single request.
    """
    # Validate extension
    ext = Path(file.filename or "").suffix.lower()
    if ext not in settings.allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=(
                f"File type '{ext}' not allowed. "
                f"Accepted: {', '.join(settings.allowed_extensions)}"
            ),
        )

    # Read content
    content = await file.read()

    # Validate size
    if len(content) > settings.max_video_size:
        max_mb = settings.max_video_size / (1024 * 1024)
        raise HTTPException(
            status_code=400,
            detail=f"File size exceeds maximum of {max_mb:.0f} MB",
        )

    # Generate unique IDs
    video_id = uuid.uuid4().hex[:12]
    job_id = uuid.uuid4().hex[:12]

    # Save to disk
    upload_dir = Path(settings.upload_dir)
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_filename = f"{video_id}{ext}"
    save_path = upload_dir / safe_filename
    with open(save_path, "wb") as f:
        f.write(content)

    logger.info("Upload+Analyze: %s (%d bytes) → %s", file.filename, len(content), save_path)

    # Extract video metadata
    video_meta: dict = {"width": None, "height": None, "fps": None,
                        "frame_count": None, "duration": None}
    try:
        info = get_video_info(str(save_path))
        video_meta = info
    except Exception as exc:
        logger.warning("Could not read video metadata: %s", exc)

    # Register video
    now = datetime.utcnow()
    _video_registry[video_id] = {
        "video_id": video_id,
        "filename": file.filename or safe_filename,
        "file_path": str(save_path),
        "file_size": len(content),
        "uploaded_at": now,
        **video_meta,
    }

    # Import the analysis background task
    from app.api.routes.analysis import _run_analysis, _job_store

    # Create analysis job
    try:
        bt = BallType(ball_type)
    except ValueError:
        bt = BallType.RED

    _job_store[job_id] = {
        "job_id": job_id,
        "video_id": video_id,
        "status": AnalysisStatus.PENDING,
        "progress": 0.0,
        "frames_processed": 0,
        "total_frames": video_meta.get("frame_count", 0) or 0,
        "message": "Job queued",
        "started_at": None,
        "completed_at": None,
        "error": None,
        "result": None,
        "video_path": str(save_path),
    }

    background_tasks.add_task(
        _run_analysis,
        job_id=job_id,
        video_id=video_id,
        ball_type=bt.value,
        frame_skip=frame_skip,
        auto_calibrate=auto_calibrate,
        calibration=None,
    )

    return AnalysisStatusResponse(
        job_id=job_id,
        video_id=video_id,
        status=AnalysisStatus.PENDING,
        progress=0.0,
        frames_processed=0,
        total_frames=_job_store[job_id]["total_frames"],
        message="Video uploaded and analysis queued.",
    )
