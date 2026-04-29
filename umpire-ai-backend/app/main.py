"""
FastAPI application entry point for Umpire AI Backend.

Creates the application, configures CORS, includes all API routers,
and sets up lifecycle hooks for ensuring required directories exist.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings, Settings
from app.api.routes.upload import router as upload_router
from app.api.routes.analysis import router as analysis_router

logger = logging.getLogger("umpire_ai")


def _setup_logging(settings: Settings) -> None:
    """Configure Python logging based on application settings."""
    level = logging.DEBUG if settings.debug else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Application lifespan — create directories on startup."""
    settings = get_settings()
    _setup_logging(settings)

    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    settings.output_dir.mkdir(parents=True, exist_ok=True)
    logger.info(
        "Umpire AI v%s starting (debug=%s)",
        settings.app_version,
        settings.debug,
    )
    yield
    logger.info("Umpire AI shutting down")


def create_app() -> FastAPI:
    """Application factory.  Returns a configured :class:`FastAPI` instance."""
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description=(
            "Real-time cricket ball trajectory analysis system using "
            "OpenCV computer vision.  Detects the ball in video frames, "
            "tracks it across frames, estimates trajectory with Kalman "
            "filtering, maps to pitch coordinates, and produces umpire "
            "decisions (LBW, Bowled, Wide, No-ball)."
        ),
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
    )

    # CORS — allow all origins (credentials=False required for wildcard)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["*"],
    )

    # Include routers
    app.include_router(upload_router)
    app.include_router(analysis_router)

    return app


# Module-level app instance (used by ``uvicorn app.main:app``)
app = create_app()


@app.get("/", tags=["health"])
async def root() -> dict:
    """Health-check endpoint."""
    return {
        "app": get_settings().app_name,
        "version": get_settings().app_version,
        "status": "ok",
    }


@app.get("/health", tags=["health"])
async def health() -> dict:
    """Detailed health check including configuration."""
    settings = get_settings()
    return {
        "status": "healthy",
        "version": settings.app_version,
        "debug": settings.debug,
        "upload_dir_exists": settings.upload_dir.exists(),
        "output_dir_exists": settings.output_dir.exists(),
    }
