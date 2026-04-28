"""
Analysis API routes.

Provides endpoints for starting video analysis jobs, checking progress,
retrieving results, downloading annotated frames, and streaming annotated
video with trajectory overlays.
"""

import uuid
import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import (
    APIRouter, HTTPException, BackgroundTasks, Depends, Query,
)
from fastapi.responses import StreamingResponse, JSONResponse

from app.config import get_settings, Settings
from app.models.schemas import (
    AnalysisRequest,
    AnalysisStatusResponse,
    AnalysisResultResponse,
    FrameDataListResponse,
    FrameDataSchema,
    BallPositionSchema,
    TrajectoryPointSchema,
    AnalysisStatus,
)
from app.services.video_processor import VideoProcessor, ProcessingCallbacks
from app.utils.frame_utils import encode_frame_jpeg
from app.api.routes.upload import _video_registry

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["analysis"])

# In-memory job store (production: replace with DB / Redis)
_job_store: dict = {}


# ======================================================================
# Helpers
# ======================================================================

def _get_job(job_id: str) -> dict:
    """Retrieve a job from the store or raise 404."""
    job = _job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Analysis job not found")
    return job


def _find_video(video_id: str) -> dict:
    """Retrieve a video from the registry or raise 404."""
    entry = _video_registry.get(video_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Video not found")
    return entry


# ======================================================================
# Background task
# ======================================================================

def _run_analysis(
    job_id: str,
    video_id: str,
    ball_type: str,
    frame_skip: int,
    auto_calibrate: bool,
    calibration: Optional[dict],
) -> None:
    """Background task that executes the full CV pipeline."""
    import time

    job = _job_store.get(job_id)
    if not job:
        return

    job["status"] = AnalysisStatus.PROCESSING
    job["started_at"] = datetime.utcnow()

    settings = Settings()
    processor = VideoProcessor(settings)

    # Build callbacks
    def on_progress(progress: float, message: str) -> None:
        if job_id in _job_store:
            _job_store[job_id]["progress"] = progress
            _job_store[job_id]["message"] = message

    callbacks = ProcessingCallbacks(
        on_progress=on_progress,
    )

    try:
        result = processor.process(
            video_path=job["video_path"],
            job_id=job_id,
            ball_type=ball_type,
            frame_skip=frame_skip,
            auto_calibrate=auto_calibrate,
            calibration=calibration,
            callbacks=callbacks,
        )

        job["status"] = AnalysisStatus.COMPLETED
        job["completed_at"] = datetime.utcnow()
        job["result"] = result

    except Exception as exc:
        logger.exception("Analysis job %s failed", job_id)
        job["status"] = AnalysisStatus.FAILED
        job["completed_at"] = datetime.utcnow()
        job["error"] = str(exc)


# ======================================================================
# Endpoints
# ======================================================================

@router.post(
    "/analyze/{video_id}",
    response_model=AnalysisStatusResponse,
    summary="Start a ball-trajectory analysis job",
    responses={404: {"description": "Video not found"}},
)
async def start_analysis(
    video_id: str,
    background_tasks: BackgroundTasks,
    request: Optional[AnalysisRequest] = None,
    settings: Settings = Depends(get_settings),
) -> AnalysisStatusResponse:
    """Start asynchronous analysis of an uploaded video.

    Returns a ``job_id`` that can be polled for progress and results.
    """
    video = _find_video(video_id)

    if not request:
        request = AnalysisRequest()

    job_id = uuid.uuid4().hex[:12]

    _job_store[job_id] = {
        "job_id": job_id,
        "video_id": video_id,
        "status": AnalysisStatus.PENDING,
        "progress": 0.0,
        "frames_processed": 0,
        "total_frames": video.get("frame_count", 0) or 0,
        "message": "Job queued",
        "started_at": None,
        "completed_at": None,
        "error": None,
        "result": None,
        "video_path": video["file_path"],
    }

    background_tasks.add_task(
        _run_analysis,
        job_id=job_id,
        video_id=video_id,
        ball_type=request.ball_type.value,
        frame_skip=request.frame_skip,
        auto_calibrate=request.auto_calibrate,
        calibration=request.calibration.model_dump() if request.calibration else None,
    )

    return AnalysisStatusResponse(
        job_id=job_id,
        video_id=video_id,
        status=AnalysisStatus.PENDING,
        progress=0.0,
        frames_processed=0,
        total_frames=_job_store[job_id]["total_frames"],
        message="Analysis job queued. Poll /api/analysis/{job_id}/status for progress.",
    )


@router.get(
    "/analysis/{job_id}/status",
    response_model=AnalysisStatusResponse,
    summary="Check analysis job status",
)
async def get_analysis_status(job_id: str) -> AnalysisStatusResponse:
    """Return the current status and progress of an analysis job."""
    job = _get_job(job_id)

    return AnalysisStatusResponse(
        job_id=job["job_id"],
        video_id=job["video_id"],
        status=job["status"],
        progress=job["progress"],
        frames_processed=job.get("frames_processed", 0),
        total_frames=job.get("total_frames", 0),
        message=job.get("message", ""),
        started_at=job.get("started_at"),
        completed_at=job.get("completed_at"),
        error=job.get("error"),
    )


@router.get(
    "/analysis/{job_id}/result",
    response_model=AnalysisResultResponse,
    summary="Get full analysis result",
    responses={
        200: {"description": "Analysis result ready"},
        202: {"description": "Analysis still in progress"},
    },
)
async def get_analysis_result(job_id: str) -> JSONResponse:
    """Return the complete analysis result including the umpire decision.

    Returns HTTP 202 if the job has not yet completed.
    """
    job = _get_job(job_id)

    if job["status"] in (AnalysisStatus.PENDING, AnalysisStatus.PROCESSING):
        return JSONResponse(
            status_code=202,
            content={
                "job_id": job_id,
                "status": job["status"].value,
                "message": "Analysis is still in progress. "
                           f"Current progress: {job['progress']:.0%}",
            },
        )

    if job["status"] == AnalysisStatus.FAILED:
        raise HTTPException(
            status_code=500,
            detail=f"Analysis failed: {job.get('error', 'Unknown error')}",
        )

    result = job.get("result", {})
    decision_data = result.get("decision", {})

    from app.models.schemas import DecisionResponse
    decision = DecisionResponse(**decision_data) if decision_data else None

    trajectory = [
        TrajectoryPointSchema(**tp) for tp in result.get("trajectory", [])
    ]

    return AnalysisResultResponse(
        job_id=job_id,
        video_id=job["video_id"],
        status=job["status"],
        decision=decision,
        trajectory=trajectory,
        total_frames=result.get("total_frames", 0),
        frames_with_ball=result.get("frames_with_ball", 0),
        ball_type=result.get("ball_type", "red"),
        ball_speed_kmh=result.get("ball_speed_kmh", 0.0),
        deviation_degrees=result.get("deviation_degrees", 0.0),
        predicted_stump_hit=result.get("predicted_stump_hit", False),
        confidence=result.get("confidence", 0.0),
        processing_time=result.get("processing_time"),
        annotated_video_path=result.get("annotated_video_path"),
    )


@router.get(
    "/analysis/{job_id}/frames",
    response_model=FrameDataListResponse,
    summary="Get frame-by-frame detection data",
)
async def get_frame_data(
    job_id: str,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
) -> FrameDataListResponse:
    """Return per-frame ball detection data.

    Supports pagination via ``offset`` and ``limit`` query parameters.
    """
    job = _get_job(job_id)

    if job["status"] != AnalysisStatus.COMPLETED:
        raise HTTPException(
            status_code=202,
            detail="Analysis not yet completed",
        )

    all_frames = job.get("result", {}).get("per_frame_data", [])
    total = len(all_frames)
    page = all_frames[offset:offset + limit]

    frame_data_list: list = []
    for fd in page:
        bp = fd.get("ball_position")
        ball_pos = BallPositionSchema(**bp) if bp else None
        frame_data_list.append(FrameDataSchema(
            frame_number=fd["frame_number"],
            timestamp=fd["timestamp"],
            ball_detected=fd["ball_detected"],
            ball_position=ball_pos,
        ))

    return FrameDataListResponse(
        job_id=job_id,
        frame_data=frame_data_list,
        total_frames=total,
        returned_frames=len(frame_data_list),
        offset=offset,
        limit=limit,
    )


@router.get(
    "/analysis/{job_id}/video",
    summary="Stream the annotated output video",
    responses={
        200: {"description": "Annotated video file (MP4)"},
        404: {"description": "Annotated video not available"},
    },
)
async def get_annotated_video(job_id: str) -> StreamingResponse:
    """Stream the annotated video with trajectory overlay.

    Returns a multipart MP4 stream if the annotated video has been
    generated.
    """
    job = _get_job(job_id)

    if job["status"] != AnalysisStatus.COMPLETED:
        raise HTTPException(
            status_code=202,
            detail="Analysis not yet completed",
        )

    video_path = job.get("result", {}).get("annotated_video_path")
    if not video_path or not Path(video_path).exists():
        raise HTTPException(
            status_code=404,
            detail="Annotated video not available for this job",
        )

    path = Path(video_path)
    def iterfile():
        with open(path, "rb") as f:
            while chunk := f.read(1024 * 1024):  # 1 MB chunks
                yield chunk

    return StreamingResponse(
        iterfile(),
        media_type="video/mp4",
        headers={
            "Content-Disposition": f"attachment; filename={path.name}",
        },
    )


@router.get(
    "/analysis/{job_id}/stream",
    summary="Server-Sent Events stream for live progress",
)
async def analysis_event_stream(job_id: str):
    """SSE endpoint that pushes progress events during analysis.

    Each event is a JSON object with ``progress`` and ``message`` fields.
    The stream closes when the job completes or fails.
    """
    job = _get_job(job_id)

    async def event_generator():
        last_progress = -1.0
        while True:
            # Refresh from store
            current = _job_store.get(job_id)
            if not current:
                yield f"data: {{\"error\": \"Job lost\"}}\n\n"
                break

            progress = current["progress"]
            if progress != last_progress:
                import json
                payload = json.dumps({
                    "job_id": job_id,
                    "status": current["status"].value,
                    "progress": progress,
                    "message": current.get("message", ""),
                })
                yield f"data: {payload}\n\n"
                last_progress = progress

            if current["status"] in (
                AnalysisStatus.COMPLETED,
                AnalysisStatus.FAILED,
            ):
                # Send final event
                import json
                final = json.dumps({
                    "job_id": job_id,
                    "status": current["status"].value,
                    "progress": progress,
                    "message": current.get("message", ""),
                    "error": current.get("error"),
                })
                yield f"data: {final}\n\n"
                break

            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
