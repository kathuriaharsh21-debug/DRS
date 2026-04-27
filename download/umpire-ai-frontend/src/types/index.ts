// ─── Upload ───────────────────────────────────────────────

export interface UploadResponse {
  video_id: string;
  filename: string;
  size: number;
  duration_seconds: number;
  fps: number;
  resolution: { width: number; height: number };
}

// ─── Analysis ─────────────────────────────────────────────

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type DecisionType = 'LBW' | 'BOWLED' | 'CAUGHT_BEHIND' | 'NOT_OUT' | 'NO_BALL' | 'WIDE';
export type Decision = 'OUT' | 'NOT OUT';
export type PredictedPath = 'HITTING' | 'MISSING';
export type BallType = 'red' | 'white' | 'pink';

export interface AnalysisResponse {
  job_id: string;
  video_id: string;
  status: JobStatus;
}

export interface StatusResponse {
  job_id: string;
  status: JobStatus;
  progress: number;
  current_step: string;
  steps_completed: number;
  total_steps: number;
  message?: string;
}

// ─── Frame Data ───────────────────────────────────────────

export interface TrajectoryPoint {
  x: number;
  y: number;
  frame_number: number;
  timestamp: number;
}

export interface FrameDataPoint {
  frame_number: number;
  timestamp: number;
  ball_detected: boolean;
  ball_position: { x: number; y: number } | null;
  confidence: number;
  trajectory_up_to_frame: TrajectoryPoint[];
}

// ─── Analysis Result ──────────────────────────────────────

export interface TrajectoryData {
  pitch_point: { x: number; y: number } | null;
  impact_point: { x: number; y: number } | null;
  deviation_degrees: number;
  predicted_path: PredictedPath;
  points: TrajectoryPoint[];
}

export interface AnalysisResultResponse {
  job_id: string;
  video_id: string;
  decision: Decision;
  dismissal_type: DecisionType;
  confidence: number;
  reason: string;
  ball_speed_kmh: number;
  trajectory: TrajectoryData;
  frames: FrameDataPoint[];
  annotated_video_url?: string;
  processing_time_seconds: number;
}

export interface FrameDataResponse {
  job_id: string;
  frames: FrameDataPoint[];
  total_frames: number;
}

// ─── Upload & Analyze (combined) ──────────────────────────

export interface UploadAndAnalyzeResponse {
  job_id: string;
  video_id: string;
  status: JobStatus;
}

// ─── App State ────────────────────────────────────────────

export interface AnalysisStatus {
  job_id: string;
  status: JobStatus;
  progress: number;
  current_step: string;
  steps_completed: number;
  total_steps: number;
  message?: string;
}

// ─── Processing Steps ─────────────────────────────────────

export interface ProcessingStep {
  id: string;
  label: string;
  description: string;
  icon: string;
}
