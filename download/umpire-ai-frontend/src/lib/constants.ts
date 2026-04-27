import type { ProcessingStep } from '../types';

// ─── App Constants ────────────────────────────────────────

export const APP_TITLE = 'Umpire AI';
export const APP_SUBTITLE = 'Cricket Ball Trajectory Analysis System';
export const APP_VERSION = '2.0.0';

// ─── Accepted Video Formats ───────────────────────────────

export const ACCEPTED_VIDEO_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/x-matroska',
];

export const ACCEPTED_EXTENSIONS = '.mp4,.webm,.mov,.avi,.mkv';

export const MAX_FILE_SIZE_MB = 500;

// ─── Playback ─────────────────────────────────────────────

export const DEFAULT_FPS = 30;
export const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2] as const;

// ─── Processing Pipeline Steps ────────────────────────────

export const PROCESSING_STEPS: ProcessingStep[] = [
  {
    id: 'frame-extraction',
    label: 'Frame Extraction',
    description: 'Extracting video frames at 30fps for analysis',
    icon: 'Film',
  },
  {
    id: 'ball-detection',
    label: 'Ball Detection',
    description: 'Detecting cricket ball using HSV color space and contour analysis',
    icon: 'Crosshair',
  },
  {
    id: 'ball-tracking',
    label: 'Ball Tracking',
    description: 'Multi-frame association and ball trajectory tracking',
    icon: 'Move',
  },
  {
    id: 'trajectory-estimation',
    label: 'Trajectory Estimation',
    description: 'Estimating 3D trajectory using Kalman filter',
    icon: 'TrendingUp',
  },
  {
    id: 'pitch-mapping',
    label: 'Pitch Mapping',
    description: 'Mapping trajectory to pitch coordinates via perspective transform',
    icon: 'Map',
  },
  {
    id: 'decision-engine',
    label: 'Decision Engine',
    description: 'Rule-based analysis for LBW / Bowled / Caught Behind decisions',
    icon: 'Gavel',
  },
];

// ─── Cricket Pitch Dimensions (in meters) ─────────────────

export const PITCH_LENGTH_M = 20.12;
export const PITCH_WIDTH_M = 3.05;
export const STUMP_WIDTH_M = 0.2286;
export const STUMP_HEIGHT_M = 0.71;
export const CREASE_LENGTH_M = 2.44;
export const POPPING_CREASE_WIDTH_M = 1.22;

// ─── Colors ───────────────────────────────────────────────

export const COLORS = {
  trajectoryGreen: '#34d399',
  trajectoryAmber: '#fbbf24',
  trajectoryRed: '#ef4444',
  trajectoryBlue: '#3b82f6',
  ballGlow: '#fbbf24',
  pitchMark: '#34d399',
  impactMark: '#f59e0b',
  wicketHighlight: '#ef4444',
  missingHighlight: '#3b82f6',
  stumps: '#e2e8f0',
  crease: '#94a3b8',
  pitchSurface: '#1a5c35',
  pitchDark: '#0f3d22',
} as const;
