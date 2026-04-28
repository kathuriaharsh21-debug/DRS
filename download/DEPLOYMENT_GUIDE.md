# Umpire AI — Complete Deployment & GitHub Guide

## Table of Contents
1. [Project Overview](#project-overview)
2. [GitHub Setup (Create Repositories)](#step-1-github-setup)
3. [GitHub Personal Access Token](#step-2-github-personal-access-token)
4. [Push Code to GitHub](#step-3-push-code-to-github)
5. [Deploy Backend](#step-4-deploy-backend)
6. [Deploy Frontend](#step-5-deploy-frontend)
7. [Connect Frontend to Backend (Environment Variables)](#step-6-connect-frontend-to-backend)
8. [Docker Deployment (Self-Hosted)](#step-7-docker-deployment)
9. [Testing Your Deployment](#step-8-testing)
10. [Troubleshooting](#troubleshooting)

---

## Project Overview

**Umpire AI** is a cricket decision-support system with two independent components:

| Component | Tech Stack | Purpose |
|---|---|---|
| **Backend** | Python 3.11, FastAPI, OpenCV, YOLOv11, UKF | Ball detection, tracking, trajectory analysis, decision engine |
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS | Video upload, frame-by-frame player, trajectory canvas, decision display |

**Communication:** REST API (frontend calls backend endpoints)

**Project Structure:**
```
umpire-ai/
├── umpire-ai-backend/        # Python FastAPI backend (separate repo)
│   ├── app/
│   │   ├── api/routes/       # Upload & Analysis endpoints
│   │   ├── core/             # Detection, tracking, trajectory, pitch mapping
│   │   ├── models/           # Pydantic schemas
│   │   ├── services/         # Video processor orchestration
│   │   ├── utils/            # Frame utils, drawing helpers
│   │   ├── config.py         # Settings management
│   │   └── main.py           # FastAPI app factory
│   ├── tests/
│   ├── scripts/
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── .env.example
│   └── .gitignore
│
├── umpire-ai-frontend/       # React TypeScript frontend (separate repo)
│   ├── src/
│   │   ├── components/       # Upload, analysis, video, common components
│   │   ├── hooks/            # useVideoUpload, useFramePlayer, useAnalysis
│   │   ├── lib/              # API client, constants
│   │   ├── types/            # TypeScript interfaces
│   │   ├── pages/            # Upload, Processing, Analysis pages
│   │   └── styles/           # Global CSS, animations
│   ├── public/
│   ├── package.json
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── vercel.json
│   ├── .env.example
│   └── .gitignore
│
├── docker-compose.prod.yml   # Full-stack production Docker
└── nginx-proxy.conf          # Reverse proxy config
```

---

## Step 1: GitHub Setup

### Create Two Separate Repositories

Go to [https://github.com/new](https://github.com/new) and create:

1. **Backend repo:** `umpire-ai-backend`
   - Description: `Cricket ball trajectory analysis backend — YOLOv11 + UKF + BoT-SORT`
   - **DO NOT** initialize with README (we'll push existing code)
   - Public or Private (your choice)

2. **Frontend repo:** `umpire-ai-frontend`
   - Description: `Umpire AI frontend — React + TypeScript video analysis dashboard`
   - **DO NOT** initialize with README
   - Public or Private (your choice)

---

## Step 2: GitHub Personal Access Token

### Why You Need a Token
Git commands from the terminal need authentication. A Personal Access Token (PAT) acts as your password.

### How to Create a Token

1. Go to **GitHub Settings** → [https://github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **"Generate new token (classic)"**
3. Fill in:
   - **Note:** `Umpire AI Deployment`
   - **Expiration:** Choose `90 days` or `Custom` → set a date
   - **Select scopes:** Check these boxes:
     - ✅ `repo` (full control of private repositories)
     - ✅ `workflow` (if you plan to add GitHub Actions CI/CD)
     - ✅ `write:packages` (if publishing Docker images)
4. Click **"Generate token"**
5. **COPY THE TOKEN** — you will NOT see it again!

### Share Token With Me (the AI)
If you want me to push the code for you, share the token by either:
- Pasting it directly in the chat
- Setting it as an environment variable: `export GITHUB_TOKEN=ghp_xxxxxxxxxxxx`

> **Security Note:** After I push the code, you can revoke the token at [https://github.com/settings/tokens](https://github.com/settings/tokens).

---

## Step 3: Push Code to GitHub

### Option A: Let Me Push It (Give Me Your Token & Username)

Give me:
- Your **GitHub username**
- Your **Personal Access Token** (starts with `ghp_`)
- Your **GitHub email** (for git config)

I'll run:
```bash
# Backend
cd umpire-ai-backend
git init
git remote add origin https://<TOKEN>@github.com/<USERNAME>/umpire-ai-backend.git
git add .
git commit -m "feat: Umpire AI v2 — YOLOv11 + UKF + BoT-SORT hybrid pipeline"
git branch -M main
git push -u origin main

# Frontend
cd umpire-ai-frontend
git init
git remote add origin https://<TOKEN>@github.com/<USERNAME>/umpire-ai-frontend.git
git add .
git commit -m "feat: Umpire AI frontend — React 18 + TypeScript dashboard"
git branch -M main
git push -u origin main
```

### Option B: Push It Yourself (Manual)

Replace `<USERNAME>` with your GitHub username:

```bash
# ============================================
# BACKEND
# ============================================
cd umpire-ai-backend

# Initialize git
git init
git config user.name "<YOUR_NAME>"
git config user.email "<YOUR_EMAIL>"

# Add all files
git add .

# Commit
git commit -m "feat: Umpire AI v2 backend — YOLOv11 + UKF + BoT-SORT hybrid pipeline"

# Add remote
git remote add origin https://github.com/<USERNAME>/umpire-ai-backend.git

# Push
git branch -M main
git push -u origin main

# ============================================
# FRONTEND
# ============================================
cd ../umpire-ai-frontend

# Initialize git
git init
git config user.name "<YOUR_NAME>"
git config user.email "<YOUR_EMAIL>"

# Add all files
git add .

# Commit
git commit -m "feat: Umpire AI frontend — React 18 + TypeScript analysis dashboard"

# Add remote
git remote add origin https://github.com/<USERNAME>/umpire-ai-frontend.git

# Push
git branch -M main
git push -u origin main
```

> **If prompted for credentials:** Use your GitHub username and the Personal Access Token (NOT your GitHub password).

---

## Step 4: Deploy Backend

### Option 1: Railway (Recommended — Easiest)

1. Go to [https://railway.app](https://railway.app) → Sign in with GitHub
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Select `umpire-ai-backend`
4. Railway auto-detects Python. Set:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Environment Variables:**
     ```
     DETECTION_TIER=auto
     TRACKING_TIER=auto
     USE_UKF=true
     BALL_TYPE=red
     DEBUG=false
     ```
5. Click **Deploy** → wait ~3-5 minutes
6. Railway gives you a URL like: `https://umpire-ai-backend.up.railway.app`
7. Test: Visit `https://umpire-ai-backend.up.railway.app/health`

> **Note:** Railway free tier has 500 hours/month. After that, it's $5/month.

### Option 2: Render.com (Free Tier Available)

1. Go to [https://render.com](https://render.com) → Sign in with GitHub
2. Click **"New"** → **"Web Service"**
3. Connect your `umpire-ai-backend` repo
4. Settings:
   - **Runtime:** Python 3
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type:** Free (or Starter at $7/month for faster processing)
5. Add environment variables from `.env.example`
6. Deploy → URL like: `https://umpire-ai-backend.onrender.com`

> **Note:** Render free tier spins down after 15 minutes of inactivity (cold start ~30 seconds).

### Option 3: Your Own VPS (DigitalOcean, AWS EC2, etc.)

```bash
# SSH into your server
ssh root@your-server-ip

# Clone the repo
git clone https://github.com/<USERNAME>/umpire-ai-backend.git
cd umpire-ai-backend

# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies (CPU-only)
pip install fastapi uvicorn[standard] python-multipart opencv-python-headless \
    numpy scipy Pillow filterpy pydantic pydantic-settings python-dotenv aiofiles

# Configure
cp .env.example .env
nano .env  # Edit settings

# Run with systemd (production)
# Create /etc/systemd/system/umpire-ai.service:
# [Unit]
# Description=Umpire AI Backend
# After=network.target
#
# [Service]
# User=root
# WorkingDirectory=/root/umpire-ai-backend
# ExecStart=/root/umpire-ai-backend/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
# Restart=always
#
# [Install]
# WantedBy=multi-user.target
#
# Then: systemctl enable umpire-ai && systemctl start umpire-ai
```

---

## Step 5: Deploy Frontend

### Option 1: Vercel (Recommended — Free)

1. Go to [https://vercel.com](https://vercel.com) → Sign in with GitHub
2. Click **"Add New..."** → **"Project"**
3. Import your `umpire-ai-frontend` repo
4. Settings:
   - **Framework Preset:** Vite
   - **Root Directory:** `.` (default)
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. **Environment Variables:**
   - `VITE_API_URL` = `https://your-backend-url.onrender.com` (your deployed backend URL)
6. Click **Deploy**
7. Vercel gives you a URL like: `https://umpire-ai-frontend.vercel.app`

> **Note:** Vercel free tier is very generous — 100GB bandwidth/month, unlimited sites.

### Option 2: Netlify (Free)

1. Go to [https://netlify.com](https://netlify.com) → Sign in with GitHub
2. Click **"Add new site"** → **"Import an existing project"**
3. Select `umpire-ai-frontend`
4. Build settings:
   - **Build Command:** `npm run build`
   - **Publish Directory:** `dist`
5. Environment Variables:
   - `VITE_API_URL` = `https://your-backend-url`
6. Deploy

---

## Step 6: Connect Frontend to Backend

### The Critical Step

The frontend needs to know where the backend is. This is controlled by the `VITE_API_URL` environment variable.

| Deployment | Set VITE_API_URL to... |
|---|---|
| **Vercel frontend + Railway backend** | `https://umpire-ai-backend.up.railway.app` |
| **Vercel frontend + Render backend** | `https://umpire-ai-backend.onrender.com` |
| **Netlify frontend + Railway backend** | `https://umpire-ai-backend.up.railway.app` |
| **Docker (same server)** | (handled by nginx proxy — no config needed) |

### On Vercel:
1. Go to your project → **Settings** → **Environment Variables**
2. Add: `VITE_API_URL` = your backend URL
3. **Redeploy** (Deployments → latest → ⋯ → Redeploy)

### On Netlify:
1. Site settings → **Build & deploy** → **Environment**
2. Add: `VITE_API_URL` = your backend URL
3. **Clear cache and deploy site**

---

## Step 7: Docker Deployment

### Full-Stack on a Single Server

If you have a VPS (DigitalOcean droplet, AWS EC2, etc.):

```bash
# Clone both repos
git clone https://github.com/<USERNAME>/umpire-ai-backend.git
git clone https://github.com/<USERNAME>/umpire-ai-frontend.git

# Create docker-compose.prod.yml and nginx-proxy.conf
# (these are in the download folder already)

# Set environment
cd umpire-ai-backend
cp .env.example .env
nano .env  # Set DEBUG=false, etc.

# Start everything
docker-compose -f docker-compose.prod.yml up -d --build

# Your app is live at http://your-server-ip
```

### What Each Docker Container Does

| Container | Port | Role |
|---|---|---|
| `umpire-ai-backend` | 8000 (internal) | FastAPI — video processing, CV pipeline |
| `umpire-ai-frontend` | 80 (internal) | nginx serving React build |
| `umpire-ai-proxy` | 80/443 (public) | Reverse proxy — routes traffic |

---

## Step 8: Testing

### Backend Health Check
```bash
curl https://your-backend-url/health
# Expected: {"status":"healthy","version":"2.0.0","debug":false,...}
```

### Backend API Docs
```
https://your-backend-url/docs       # Swagger UI
https://your-backend-url/redoc      # ReDoc
```

### Frontend
```
https://your-frontend-url
# Should show the Umpire AI upload page
```

### End-to-End Test
1. Open the frontend URL
2. Upload a cricket video (umpire camera view)
3. Click "Analyze"
4. Wait for processing (watch the progress pipeline)
5. View frame-by-frame analysis, trajectory, pitch map, and decision

---

## Troubleshooting

### "CORS error" in browser console
- The backend's CORS is set to `allow_origins=["*"]` in development
- In production, update `app/main.py` to allow only your frontend domain
- Or set `CORS_ORIGINS` env var in backend

### "Connection refused" when frontend calls backend
- Check `VITE_API_URL` is set correctly in frontend deployment
- Make sure backend is running and `/health` returns 200
- Check if the backend URL is accessible (try `curl` from another machine)

### Video upload fails (413 error)
- Increase `client_max_body_size` in nginx config
- Default is 500MB — should be enough for most videos

### Backend crashes on large videos
- Railway free tier has 512MB RAM — large videos may OOM
- Upgrade to Railway hobby plan ($5/month) for 1GB RAM
- Or use Render with 512MB+ instance type
- Set `FRAME_SKIP=3` to process fewer frames (faster, less memory)

### YOLO model not found
- `DETECTION_TIER=auto` will fall back to HSV if no model is found
- To use YOLO: train a model, save as `yolo11s_cricket_ball.pt`, put in project root
- For CPU-only servers, HSV fallback works well

### Analysis takes too long
- Reduce `YOLO_IMGSZ` from 1280 to 640 (faster but less accurate)
- Increase `FRAME_SKIP` from 2 to 3 or 4
- Use `DETECTION_TIER=classical` to skip YOLO entirely

---

## Quick Reference: All Links

| What | URL |
|---|---|
| GitHub (new repo) | https://github.com/new |
| GitHub Tokens | https://github.com/settings/tokens |
| Railway | https://railway.app |
| Render | https://render.com |
| Vercel | https://vercel.com |
| Netlify | https://netlify.com |
| Backend API docs (local) | http://localhost:8000/docs |

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        YOUR BROWSER                              │
│                    https://umpire-ai.vercel.app                  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                     Vercel (Frontend CDN)                        │
│           React 18 + TypeScript + Tailwind CSS                   │
│  ┌──────────┐ ┌───────────┐ ┌──────────┐ ┌──────────────────┐  │
│  │  Upload   │ │  Frame    │ │ Trajectory│ │   Decision       │  │
│  │  Page     │ │  Player   │ │  Canvas   │ │   Panel          │  │
│  └──────────┘ └───────────┘ └──────────┘ └──────────────────┘  │
└──────────────────────────┬───────────────────────────────────────┘
                           │ REST API (VITE_API_URL)
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│              Railway / Render (Backend Server)                    │
│         Python 3.11 + FastAPI + OpenCV + YOLOv11                 │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Ball Detect  │→│ Ball Track   │→│ Trajectory Estimate   │   │
│  │ YOLOv11/HSV  │  │ BoT-SORT/   │  │ UKF / Linear KF      │   │
│  │              │  │ Hungarian    │  │ + Physics Model      │   │
│  └─────────────┘  └──────────────┘  └──────────┬───────────┘   │
│                                                   │               │
│  ┌─────────────────────┐  ┌───────────────────────▼───────────┐ │
│  │ Pitch Mapper         │  │ Decision Engine (ICC Rules)      │ │
│  │ Perspective Transform│  │ LBW / Bowled / Wide / No-ball    │ │
│  └─────────────────────┘  └───────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```
