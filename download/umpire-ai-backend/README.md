# Umpire AI Backend

> Real-time cricket ball trajectory analysis system using OpenCV computer vision.

Umpire AI detects the cricket ball in video frames, tracks it across frames using velocity-predicted association, estimates trajectory with Kalman filtering, maps positions to pitch coordinates via perspective transforms, and produces umpire decisions (LBW, Bowled, Wide, No-ball) following ICC rules.

---

## Architecture

```
Video Upload → Frame Extraction → Ball Detection (HSV + Morphological)
    → Multi-frame Tracking (Nearest-Neighbour) → Trajectory Estimation (Kalman)
    → Pitch Mapping (Perspective Transform) → Decision Engine (ICC Rules)
    → Annotated Video Output
```

### Core Modules

| Module | Description |
|---|---|
| `ball_detector.py` | HSV colour-space segmentation + morphological cleanup + MOG2 background subtraction |
| `ball_tracker.py` | Greedy nearest-neighbour association with velocity prediction |
| `trajectory_estimator.py` | 2-D Kalman filter for smoothing and pitch-point / deviation / speed estimation |
| `pitch_mapper.py` | 4-point perspective transform (manual or auto Canny+Hough detection) |
| `decision_engine.py` | ICC rules engine for LBW, Bowled, Wide, and No-ball decisions |

---

## Quick Start

### 1. Install dependencies

```bash
cd umpire-ai-backend
python -m venv .venv
source .venv/bin/activate   # Linux/macOS
pip install -r requirements.txt
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env to set BALL_TYPE, directories, etc.
```

### 3. Run

```bash
python run.py
```

The server starts at **http://localhost:8000**. Interactive API docs at:
- Swagger: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc

---

## Docker

```bash
docker-compose up --build
```

---

## API Endpoints

### Upload

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/upload` | Upload a video file |
| `GET` | `/api/videos` | List all uploaded videos |
| `GET` | `/api/videos/{video_id}` | Get video metadata |
| `DELETE` | `/api/videos/{video_id}` | Delete a video |

### Analysis

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/analyze/{video_id}` | Start analysis (returns `job_id`) |
| `GET` | `/api/analysis/{job_id}/status` | Poll job progress |
| `GET` | `/api/analysis/{job_id}/result` | Get full analysis result |
| `GET` | `/api/analysis/{job_id}/frames` | Frame-by-frame detection data (paginated) |
| `GET` | `/api/analysis/{job_id}/video` | Download annotated video |
| `GET` | `/api/analysis/{job_id}/stream` | SSE progress stream |

---

## Example API Calls

### Upload a video

```bash
curl -X POST http://localhost:8000/api/upload \
  -F "file=@delivery.mp4"
```

Response:
```json
{
  "success": true,
  "video_id": "a1b2c3d4e5f6",
  "filename": "delivery.mp4",
  "file_size": 5242880,
  "message": "Video uploaded successfully"
}
```

### Start analysis

```bash
curl -X POST http://localhost:8000/api/analyze/a1b2c3d4e5f6 \
  -H "Content-Type: application/json" \
  -d '{"ball_type": "red", "frame_skip": 2, "auto_calibrate": true}'
```

### Check status

```bash
curl http://localhost:8000/api/analysis/{job_id}/status
```

### Get result

```bash
curl http://localhost:8000/api/analysis/{job_id}/result
```

### SSE progress stream

```bash
curl -N http://localhost:8000/api/analysis/{job_id}/stream
```

---

## Configuration Reference

| Variable | Default | Description |
|---|---|---|
| `DEBUG` | `true` | Enable debug logging |
| `UPLOAD_DIR` | `./uploads` | Directory for uploaded videos |
| `OUTPUT_DIR` | `./output` | Directory for annotated output videos |
| `MAX_VIDEO_SIZE` | `524288000` | Max upload size in bytes (500 MB) |
| `BALL_TYPE` | `red` | Ball colour: `red`, `white`, or `pink` |
| `FPS_TARGET` | `30` | Target processing FPS |
| `FRAME_SKIP` | `2` | Process every Nth frame |
| `BALL_MIN_RADIUS` | `3` | Min ball radius in pixels |
| `BALL_MAX_RADIUS` | `25` | Max ball radius in pixels |

---

## How the CV Pipeline Works

1. **Frame Extraction** — Opens the video with `cv2.VideoCapture`, extracts frames at the target FPS using a skip interval.

2. **Ball Detection** — Each frame is converted to HSV colour space. A binary mask is built from ball-type-specific HSV ranges, cleaned with morphological open/close, and contour-filtered by circularity, area, and aspect ratio. Background subtraction (MOG2) provides a motion-context confidence boost.

3. **Multi-frame Tracking** — Detections are associated to tracks via greedy nearest-neighbour on predicted positions (constant-velocity model). New tracks spawn for unmatched detections; stale tracks are pruned after a configurable number of missing frames.

4. **Trajectory Estimation** — A 2-D Kalman filter (state: `[x, y, vx, vy]`) smooths the tracked positions. Derived metrics include pitch point (bounce detection), lateral deviation, ball speed (scaled to real pitch length of 20.12 m), and stump-hit prediction via linear extrapolation.

5. **Pitch Mapping** — Optional 4-point perspective transform maps pixel coordinates to real-world metres on the pitch. Supports manual calibration or automatic detection via Canny + Hough line detection.

6. **Decision Engine** — Evaluates ICC rules in priority order: No-ball → Wide → Bowled → LBW. The LBW check validates all three conditions (pitch in line, impact in line, would hit stumps) and produces a confidence-scored verdict with a human-readable explanation.

7. **Visualisation** — Annotated output video with green→amber→red trajectory path, ball glow, pitch markings, stump drawing, PITCH/IMPACT labels, and a decision banner.

---

## Calibration Tool

An interactive calibration script is provided:

```bash
python scripts/calibrate_pitch.py path/to/video.mp4
```

Click four corners of the pitch (top-left, top-right, bottom-right, bottom-left) on the displayed frame. The calibration is saved to `output/calibration_{video_id}.json` and can be supplied in the analysis request.

---

## Running Tests

```bash
pip install pytest
pytest tests/
```

---

## License

MIT
