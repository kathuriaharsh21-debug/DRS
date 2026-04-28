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

// ─── v2 Pipeline Info ────────────────────────────────────

export interface PipelineInfo {
  /** Active detection tier: "yolo", "classical", or "auto" */
  detection_tier: string;
  /** Active tracking tier: "botsort", "classical", or "auto" */
  tracking_tier: string;
  /** Trajectory filter: "ukf" or "linear_kf" */
  trajectory_filter: string;
}

// ─── v2 Bounce Point ────────────────────────────────────

export interface BouncePoint {
  x: number;
  y: number;
  frame_number: number;
  timestamp: number;
}

// ─── v2 Predicted Path Point ────────────────────────────

export interface PredictedPathPoint {
  x: number;
  y: number;
  z: number;
  bounce: boolean;
}

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
  z?: number;           // v2: height (0=ground, 1=max)
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
  /** v2: which detection tier produced this frame's data */
  detection_tier?: string;
  /** v2: which tracking tier produced this frame's data */
  tracking_tier?: string;
}

// ─── Analysis Result ──────────────────────────────────────

export interface TrajectoryData {
  pitch_point: { x: number; y: number } | null;
  impact_point: { x: number; y: number } | null;
  deviation_degrees: number;
  predicted_path: PredictedPath;
  points: TrajectoryPoint[];
  /** v2: bounce points detected in the trajectory */
  bounce_points?: BouncePoint[];
  /** v2: physics-predicted future path for LBW visualization */
  predicted_future_path?: PredictedPathPoint[];
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
  /** v2: pipeline tier information */
  pipeline?: PipelineInfo;
  /** v2: bounce points at top level */
  bounce_points?: BouncePoint[];
  /** v2: predicted future path at top level */
  predicted_path_data?: PredictedPathPoint[];
  /** v2: number of frames with ball detected */
  frames_with_ball?: number;
  /** v2: total frames processed */
  frames_processed?: number;
  /** v2: overall confidence from trajectory estimator */
  trajectory_confidence?: number;
  /** v2: predicted stump hit */
  predicted_stump_hit?: boolean;
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
