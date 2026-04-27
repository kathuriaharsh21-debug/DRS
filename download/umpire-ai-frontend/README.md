# Umpire AI — Cricket Ball Trajectory Analysis Frontend

A production-ready React + TypeScript frontend for analyzing cricket ball trajectories and predicting dismissal decisions (LBW, Bowled, Caught Behind).

## Architecture

```
┌─────────────────────┐      ┌─────────────────────┐
│   Umpire AI React   │ HTTP │  Python FastAPI      │
│   Frontend (Vite)   │◄────►│  Backend             │
│   Port 3000/80      │ REST │  Port 8000           │
└─────────────────────┘      └─────────────────────┘
```

The frontend communicates with the Python backend exclusively through a REST API. No server-side rendering — pure client-side SPA.

## Tech Stack

| Technology | Purpose |
|---|---|
| React 18 | UI framework |
| TypeScript 5 | Type safety |
| Vite 5 | Build tool & dev server |
| Tailwind CSS 3 | Utility-first styling |
| React Router DOM v6 | Client-side routing |
| Lucide React | Icon library |
| HTML5 Canvas | Pitch map & trajectory rendering |

**No heavy UI libraries** — all components are built from scratch with Tailwind CSS.

## Setup

### Prerequisites

- Node.js 18+ (or Bun)
- Python backend running on port 8000

### Installation

```bash
cd umpire-ai-frontend
npm install
```

### Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | Backend API base URL |
| `VITE_APP_TITLE` | `Umpire AI` | Application title |

### Development

```bash
npm run dev
```

Opens at `http://localhost:3000` with HMR and API proxy to backend.

### Production Build

```bash
npm run build
npm run preview
```

## Project Structure

```
src/
├── components/
│   ├── upload/          Video upload with drag & drop
│   ├── analysis/        Dashboard, decisions, pitch map, stats
│   ├── video/           Frame-by-frame player & controls
│   └── common/          Header, spinner, progress bar, badge
├── hooks/               Custom React hooks (upload, analysis, player)
├── lib/                 API client & constants
├── types/               TypeScript interfaces
├── styles/              Global CSS & custom animations
└── pages/               Route-level page components
```

## Features

### Video Upload
- Drag & drop file upload with real-time progress tracking
- Ball type selector (Red / White / Pink)
- File validation (format, size)
- Video preview before analysis

### Frame-by-Frame Player
- HTML5 video with precise frame stepping (forward/backward)
- Speed controls: 0.25x, 0.5x, 1x, 2x
- Loop markers (IN/OUT points)
- Keyboard shortcuts: Space (play/pause), Arrow keys (frame step)
- Frame counter & timecode display (MM:SS:FF)
- Canvas overlay synced with video playback

### Trajectory Canvas
- Progressive trajectory visualization (builds as video plays)
- Ball position glow with crosshair
- Gradient trajectory path (green → amber → red)
- Stumps drawing at batting end
- devicePixelRatio-aware rendering

### Pitch Map (2D Top-Down)
- Accurate cricket pitch dimensions (20.12m × 3.05m)
- Crease lines, return creases, stumps at both ends
- Ball trajectory as amber dashed line
- Pitch point marker (green circle + crosshair)
- Impact point marker (amber diamond)
- Wicket zone highlight (red glow when hitting)
- Deviation angle indicator
- Batsman position marker

### Decision Panel
- OUT / NOT OUT display with animated glow
- Dismissal type badge (LBW, Bowled, Caught Behind, etc.)
- Confidence percentage with color-coded bar
- Decision reason explanation
- Quick stats: speed, deviation, predicted path, processing time

### Processing Pipeline
- 6-step animated visualization
- Real-time progress polling from backend
- Auto-navigation to results on completion

## API Integration

All API calls go through `src/lib/api.ts`:

| Endpoint | Method | Description |
|---|---|---|
| `/api/upload-and-analyze` | POST | Upload video + start analysis (combined) |
| `/api/upload` | POST | Upload video only |
| `/api/analyze/:videoId` | POST | Start analysis on uploaded video |
| `/api/analysis/:jobId/status` | GET | Poll analysis status |
| `/api/analysis/:jobId/result` | GET | Get full analysis result |
| `/api/analysis/:jobId/frames` | GET | Get frame-by-frame data |
| `/api/analysis/:jobId/video` | GET | Get annotated video |

### Response Types

See `src/types/index.ts` for complete TypeScript interfaces:
- `UploadResponse`, `AnalysisResponse`, `StatusResponse`
- `FrameDataPoint`, `TrajectoryPoint`
- `AnalysisResultResponse`, `FrameDataResponse`

## Docker Deployment

### Build & Run

```bash
docker-compose up --build
```

Frontend serves on port 3000 (nginx), backend on port 8000.

### Configuration

- `nginx.conf` handles SPA routing and API proxy
- `Dockerfile` uses multi-stage build (Node build → nginx serve)
- Large upload support: `client_max_body_size 500M`

## Customization

### Styling

The dark sports-tech theme uses Tailwind CSS with these accent colors:
- **Primary**: Emerald-400 (`#34d399`) — success states, active elements
- **Secondary**: Amber-400 (`#fbbf24`) — trajectory, warnings, highlights
- **Error**: Red-500 (`#ef4444`) — OUT decisions, errors
- **Info**: Blue-500 (`#3b82f6`) — missing stumps indicators

### Canvas Drawing

- `TrajectoryCanvas.tsx` — overlays on video element
- `PitchMap.tsx` — standalone 2D pitch view
- Both use `requestAnimationFrame` and `devicePixelRatio`

### Custom Animations

Defined in `src/styles/globals.css`:
- `pulse-glow-green` / `pulse-glow-red` — decision card glow
- `fade-in-up`, `scale-in` — entrance animations
- `text-glow` — decision text pulse
- `shimmer` — processing step shimmer

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/name`)
3. Commit changes (`git commit -m 'Add feature'`)
4. Push to branch (`git push origin feature/name`)
5. Open a Pull Request

## License

MIT
