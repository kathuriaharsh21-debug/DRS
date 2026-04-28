# Umpire AI Backend — v2

> Real-time cricket ball trajectory analysis system using a **hybrid deep-learning + classical computer vision pipeline**.

Umpire AI v2 combines **state-of-the-art deep learning** (YOLOv11 + BoT-SORT) with **physics-based trajectory estimation** (Unscented Kalman Filter) to deliver the best accuracy possible from a single camera view. It automatically falls back to classical methods when no GPU is available.

---

## What's New in v2

| Component | v1 | v2 (Hybrid) | Improvement |
|---|---|---|---|
| **Detection** | HSV color segmentation | YOLOv11 + P2 head (auto-fallback to HSV) | Handles motion blur, occlusion, tiny 3-5px balls |
| **Tracking** | Greedy nearest-neighbour | BoT-SORT with CMC + NIC (auto-fallback to Hungarian algorithm) | Camera motion compensation, occlusion handling |
| **Trajectory** | Linear Kalman filter `[x,y,vx,vy]` | Unscented Kalman Filter + physics (gravity, drag, Magnus, bounce) | Models nonlinear ball bounces accurately |
| **Pitch Mapping** | Canny + Hough | Hierarchical line clustering + sub-pixel Canny + RANSAC | More robust auto-calibration |
| **Predicted Path** | 2-point linear extrapolation | Physics-based future trajectory (20 steps) | LBW "would hit stumps" with real physics |
| **Decision Engine** | ICC rules (unchanged) | ICC rules + bounce point awareness | Same trusted rules with richer data |

---

## Architecture

```
Video Upload → Frame Extraction
    → Ball Detection (YOLOv11+P2 / HSV fallback)
    → Multi-frame Tracking (BoT-SORT / Hungarian fallback)
    → Trajectory Estimation (UKF+Physics / Linear KF fallback)
    → Pitch Mapping (Perspective Transform + Auto Calibration)
    → Decision Engine (ICC Rules)
    → Annotated Video Output (with predicted path overlay)
```

### Core Modules

| Module | Description |
|---|---|
| `ball_detector.py` | **Hybrid**: YOLOv11 + P2 small-object head (GPU) + HSV + MOG2 fallback (CPU) |
| `ball_tracker.py` | **Hybrid**: BoT-SORT with CMC + NIC (GPU) + Hungarian algorithm tracker (CPU) |
| `trajectory_estimator.py` | **Hybrid**: UKF with gravity/drag/Magnus/bounce + Linear KF fallback |
| `pitch_mapper.py` | 4-point perspective transform with hierarchical line clustering auto-calibration |
| `decision_engine.py` | ICC rules engine for LBW, Bowled, Wide, and No-ball decisions |

---

## Quick Start

### 1. Install dependencies

```bash
cd umpire-ai-backend
python -m venv .venv
source .venv/bin/activate   # Linux/macOS

# Full install (GPU recommended):
pip install -r requirements.txt

# CPU-only install (skip PyTorch GPU, use lighter packages):
pip install fastapi uvicorn python-multipart opencv-python-headless numpy scipy \
    Pillow filterpy pydantic pydantic-settings python-dotenv aiofiles
```

> **Note:** The hybrid pipeline automatically falls back to CPU-only methods when `ultralytics` or `torch` are not installed.

### 2. (Optional) Fine-tune YOLO for cricket balls

For best accuracy, fine-tune YOLOv11 on cricket ball data:

```python
from ultralytics import YOLO

model = YOLO("yolo11s.pt")
model.train(
    data="cricket_ball.yaml",  # your dataset config
    epochs=300,
    imgsz=1280,
    batch=16,
    device="0",
    hsv_h=0.015, hsv_s=0.7, hsv_v=0.4,
    fliplr=0.0,  # don't flip — ball direction matters
    mosaic=1.0, mixup=0.1, copy_paste=0.3,
)
# Model saved to runs/detect/train/weights/best.pt
# Copy to yolo11s_cricket_ball.pt
```

Dataset: [Cricket Ball Dataset for YOLO (Kaggle)](https://www.kaggle.com/datasets/kushagra3204/cricket-ball-dataset-for-yolo)

### 3. Configure

```bash
cp .env.example .env
# Edit .env to set detection/tracking tiers, model path, etc.
```

### 4. Run

```bash
python run.py
```

Server at **http://localhost:8000**. API docs:
- Swagger: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

---

## Configuration Reference

### Tier Selection

| Variable | Default | Description |
|---|---|---|
| `DETECTION_TIER` | `auto` | `auto`, `yolo`, or `classical` |
| `TRACKING_TIER` | `auto` | `auto`, `botsort`, or `classical` |
| `USE_UKF` | `true` | `true` (nonlinear physics) or `false` (linear KF) |

### YOLO Parameters

| Variable | Default | Description |
|---|---|---|
| `YOLO_MODEL_PATH` | `yolo11s_cricket_ball.pt` | Path to trained YOLO weights |
| `YOLO_CONFIDENCE` | `0.35` | Min detection confidence |
| `YOLO_IOU_THRESHOLD` | `0.45` | NMS IoU threshold |
| `YOLO_IMGSZ` | `1280` | Inference resolution (higher = better for small balls) |
| `YOLO_DEVICE` | `` | `` (auto), `0` (GPU), or `cpu` |

### Physics Model

| Variable | Default | Description |
|---|---|---|
| `GRAVITY` | `9.81` | m/s^2 |
| `AIR_DRAG_COEFF` | `0.002` | Simplified air drag |
| `MAGNUS_COEFF` | `0.001` | Spin-induced lateral force (swing/seam) |
| `RESTITUTION` | `0.65` | Bounce coefficient of restitution |
| `SURFACE_FRICTION` | `0.4` | Pitch surface friction |

### General

| Variable | Default | Description |
|---|---|---|
| `DEBUG` | `true` | Enable debug logging |
| `UPLOAD_DIR` | `./uploads` | Directory for uploaded videos |
| `OUTPUT_DIR` | `./output` | Directory for annotated output |
| `MAX_VIDEO_SIZE` | `524288000` | Max upload size (500 MB) |
| `BALL_TYPE` | `red` | Ball colour: `red`, `white`, or `pink` |
| `FPS_TARGET` | `30` | Target processing FPS |
| `FRAME_SKIP` | `2` | Process every Nth frame |

---

## How the v2 Pipeline Works

### Detection (Hybrid)

**GPU path:** YOLOv11s with P2 (320x320) detection head. The P2 head adds a high-resolution feature map specifically for detecting objects as small as 3-5 pixels — critical for cricket balls in broadcast video. Single-class training dedicates all model capacity to ball detection. Runs at ~100 FPS on T4 GPU.

**CPU fallback:** HSV colour segmentation with MOG2 background subtraction. Detects red, white, or pink balls based on configurable colour ranges. Morphological cleanup removes noise.

### Tracking (Hybrid)

**GPU path:** BoT-SORT provides Camera Motion Compensation (CMC) to handle broadcast camera pan/tilt/zoom, and Noise Information Criterion (NIC) to down-weight blurry detections. Configured with a 30-frame track buffer for occlusion behind the bowler's body.

**CPU fallback:** Hungarian algorithm (scipy.optimize.linear_sum_assignment) for optimal global detection-to-track assignment, replacing v1's greedy nearest-neighbour.

### Trajectory Estimation (Hybrid)

**UKF path:** The Unscented Kalman Filter uses a 6D state vector `[x, y, z, vx, vy, vz]` with a full physics model including gravity, air drag (proportional to v^2), Magnus effect (spin-induced lateral force for swing/seam), and a bounce model with configurable coefficient of restitution and surface friction. The sigma-point transform naturally handles the nonlinear dynamics of ball bouncing, where vertical velocity suddenly reverses. Predicts 20 future trajectory steps for LBW "would hit stumps" visualization.

**Linear KF fallback:** The v1 constant-velocity 2D Kalman filter with `[x, y, vx, vy]` state, using linear regression for stump-hit prediction.

### Pitch Mapping

Hierarchical line clustering groups detected Canny+Hough lines by angle and proximity, identifying bowling/batting crease pairs. Sub-pixel Canny thresholds are computed from image statistics (Otsu-based). Line merging produces robust representative crease lines.

### Decision Engine

Unchanged from v1. Evaluates ICC rules in priority order: No-ball → Wide → Bowled → LBW (3 conditions: pitch in line, impact in line, would hit stumps).

---

## Docker

```bash
docker-compose up --build
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/upload` | Upload a video file |
| `GET` | `/api/videos` | List all uploaded videos |
| `GET` | `/api/videos/{video_id}` | Get video metadata |
| `DELETE` | `/api/videos/{video_id}` | Delete a video |
| `POST` | `/api/analyze/{video_id}` | Start analysis (returns `job_id`) |
| `GET` | `/api/analysis/{job_id}/status` | Poll job progress |
| `GET` | `/api/analysis/{job_id}/result` | Get full analysis result |
| `GET` | `/api/analysis/{job_id}/frames` | Frame-by-frame data (paginated) |
| `GET` | `/api/analysis/{job_id}/video` | Download annotated video |
| `GET` | `/api/analysis/{job_id}/stream` | SSE progress stream |

---

## Research References

This implementation is based on the following research:

- **YOLOv11 + P2 head:** Ultralytics docs — best small-object detection for YOLO family
- **BoT-SORT:** Aharon N., Orfaig R., Bobrovsky B.-Z. (2022) — Camera Motion Compensation + NIC
- **UKF for cricket:** Width.ai (2022) — nonlinear bounce handling for cricket ball tracking
- **MaxVit Sequential:** ACM MM 2024 — motion blur handling for fast balls
- **TrackNet:** NTU Taiwan (2019) — sequential frame analysis for sports ball detection
- **Hawk-Eye approach:** 6-8 cameras at 300 FPS → 3.6mm accuracy (ICC DRS standard)

---

## License

MIT
