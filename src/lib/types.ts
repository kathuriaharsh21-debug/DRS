// ============================================================
// Umpire AI — Core TypeScript Types
// ============================================================

/** Possible umpire decisions */
export type Decision = "OUT" | "NOT OUT";

/** Types of decisions / dismissal modes */
export type DecisionType =
  | "LBW"
  | "NO_BALL"
  | "WIDE"
  | "CAUGHT_BEHIND"
  | "BOWLED"
  | "NOT_OUT";

/** Ball trajectory data returned from analysis */
export interface TrajectoryData {
  /** Where the ball pitched on the pitch (normalized 0-1 coordinates) */
  pitchPoint: { x: number; y: number };
  /** Lateral movement in degrees */
  deviation: number;
  /** Impact height on the batsman's pad */
  impactHeight: "Low" | "Middle" | "High";
  /** Whether the predicted path hits or misses the stumps */
  predictedPath: "HITTING" | "MISSING";
  /** Ball speed in km/h */
  ballSpeed: number;
}

/** A single frame's trajectory point (for canvas animation) */
export interface FrameDataPoint {
  /** Normalized x position (0-1) */
  x: number;
  /** Normalized y position (0-1) */
  y: number;
  /** Frame number */
  frame: number;
}

/** Full analysis result from the API */
export interface AnalysisResult {
  decision: Decision;
  decisionType: DecisionType;
  confidence: number;
  trajectory: TrajectoryData;
  frameData: FrameDataPoint[];
}

/** Application screen states */
export type ScreenState = "upload" | "processing" | "analysis";

/** Processing step info */
export interface ProcessingStep {
  id: string;
  label: string;
  description: string;
  icon: string;
}

/** Processing progress from the API (SSE) */
export interface ProcessingProgress {
  step: number;
  totalSteps: number;
  currentStep: string;
  progress: number;
}
