# DRS - Decision Review System (Umpire AI)

> Cricket ball trajectory analysis system using a hybrid deep-learning + classical computer vision pipeline.

## Architecture

```
umpire-ai-frontend/   → React 18 + TypeScript + Vite (Vercel)
umpire-ai-backend/    → Python FastAPI + OpenCV + YOLOv11 (Render)
```

## Quick Start

### Backend
```bash
cd umpire-ai-backend
pip install -r requirements.txt
cp .env.example .env
python run.py
```
Server at http://localhost:8000 | API docs: http://localhost:8000/docs

### Frontend
```bash
cd umpire-ai-frontend
npm install
cp .env.example .env
npm run dev
```
Opens at http://localhost:3000

## Deployment

| Component | Platform | Link |
|---|---|---|
| Backend | Render | [View](#) |
| Frontend | Vercel | [View](#) |

See DEPLOYMENT_GUIDE.md for detailed instructions.

## v2 Pipeline

| Component | Method | Fallback |
|---|---|---|
| Detection | YOLOv11 + P2 head | HSV + MOG2 |
| Tracking | BoT-SORT + CMC + NIC | Hungarian algorithm |
| Trajectory | UKF (6D physics) | Linear Kalman Filter |
| Pitch Map | Hierarchical clustering | Manual calibration |
| Decision | ICC rules (LBW, Bowled, Wide, No-ball) | - |

## Documentation

Full project documentation: Umpire_AI_Project_Documentation.pdf

## License

MIT
