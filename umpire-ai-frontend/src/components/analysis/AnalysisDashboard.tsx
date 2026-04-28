import { useState } from 'react';
import { Map, BarChart3, Cpu } from 'lucide-react';
import { FrameByFramePlayer } from '../video/FrameByFramePlayer';
import { DecisionPanel } from './DecisionPanel';
import { PitchMap } from './PitchMap';
import { StatsPanel } from './StatsPanel';
import type { AnalysisResultResponse, BouncePoint, PredictedPathPoint } from '../../types';

interface AnalysisDashboardProps {
  result: AnalysisResultResponse;
  videoUrl: string;
}

type TabId = 'pitch-map' | 'stats' | 'pipeline';

export function AnalysisDashboard({ result, videoUrl }: AnalysisDashboardProps) {
  const [activeTab, setActiveTab] = useState<TabId>('pitch-map');

  // v2: Extract bounce and predicted path data
  const bouncePoints: BouncePoint[] = result.bounce_points || result.trajectory.bounce_points || [];
  const bounceFrameNumbers: number[] = bouncePoints.map((bp) => bp.frame_number);
  const predictedPath: PredictedPathPoint[] = result.predicted_path_data || [];

  const hasPipelineInfo = !!result.pipeline;

  const tabs: { id: TabId; label: string; icon: React.FC<{ className?: string }>; show: boolean }[] = [
    { id: 'pitch-map', label: 'Pitch Map', icon: Map, show: true },
    { id: 'stats', label: 'Statistics', icon: BarChart3, show: true },
    { id: 'pipeline', label: 'Pipeline', icon: Cpu, show: hasPipelineInfo },
  ].filter((t) => t.show);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Video + Tabs (2/3) */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Video Player */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
            <FrameByFramePlayer
              videoSrc={videoUrl}
              frames={result.frames}
              trajectoryPoints={result.trajectory.points}
              fps={30}
              bouncePoints={bouncePoints}
              predictedPath={predictedPath}
              bounceFrameNumbers={bounceFrameNumbers}
            />
          </div>

          {/* Tabs */}
          <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
            {/* Tab Headers */}
            <div className="flex border-b border-slate-800">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors relative ${
                    activeTab === tab.id
                      ? 'text-emerald-400'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}
                  {activeTab === tab.id && (
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-400" />
                  )}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="p-4">
              {activeTab === 'pitch-map' && (
                <PitchMap
                  trajectory={result.trajectory}
                  bouncePoints={bouncePoints}
                  predictedPath={predictedPath}
                />
              )}
              {activeTab === 'stats' && (
                <StatsPanel result={result} />
              )}
              {activeTab === 'pipeline' && hasPipelineInfo && result.pipeline && (
                <PipelineDetails result={result} />
              )}
            </div>
          </div>
        </div>

        {/* Right: Decision Panel (1/3) */}
        <div className="lg:col-span-1">
          <div className="sticky top-20">
            <DecisionPanel result={result} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── v2: Pipeline Details Tab ──────────────────────────────

function PipelineDetails({ result }: { result: AnalysisResultResponse }) {
  const pipeline = result.pipeline!;

  const tiers = [
    {
      label: 'Ball Detection',
      tier: pipeline.detection_tier,
      description: pipeline.detection_tier === 'yolo'
        ? 'YOLOv11 with P2 small-object head — detects balls as small as 3-5 pixels using deep learning'
        : 'HSV colour segmentation + MOG2 background subtraction — CPU-only classical method',
      isAdvanced: pipeline.detection_tier === 'yolo',
    },
    {
      label: 'Multi-Frame Tracking',
      tier: pipeline.tracking_tier,
      description: pipeline.tracking_tier === 'botsort'
        ? 'BoT-SORT with Camera Motion Compensation (CMC) + Noise Info Criterion (NIC)'
        : 'Hungarian algorithm (optimal assignment) with exponential velocity smoothing',
      isAdvanced: pipeline.tracking_tier === 'botsort',
    },
    {
      label: 'Trajectory Estimation',
      tier: pipeline.trajectory_filter,
      description: pipeline.trajectory_filter === 'ukf'
        ? 'Unscented Kalman Filter with physics model (gravity + air drag + Magnus effect + bounce)'
        : 'Linear constant-velocity Kalman filter (2D: x, y, vx, vy)',
      isAdvanced: pipeline.trajectory_filter === 'ukf',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="text-xs text-slate-500 mb-4">
        The v2 hybrid pipeline automatically selects the best available method for each stage.
        Advanced tiers provide higher accuracy but require GPU resources.
      </div>

      {tiers.map((t) => (
        <div
          key={t.label}
          className={`rounded-xl border p-4 transition-colors ${
            t.isAdvanced
              ? 'border-emerald-500/20 bg-emerald-500/5'
              : 'border-amber-500/20 bg-amber-500/5'
          }`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-slate-300">{t.label}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
              t.isAdvanced
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}>
              {t.isAdvanced ? 'GPU' : 'CPU'}
            </span>
          </div>
          <div className="text-xs text-slate-400 leading-relaxed">{t.description}</div>
          <div className="mt-2 text-[10px] font-mono text-slate-600">
            Tier: <span className="text-slate-400">{t.tier}</span>
          </div>
        </div>
      ))}

      {/* Summary */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="text-xs font-semibold text-slate-300 mb-2">Analysis Summary</div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="text-slate-500">Frames processed</div>
          <div className="text-slate-300 font-mono text-right">
            {result.frames_processed || result.frames.length}
          </div>
          <div className="text-slate-500">Frames with ball</div>
          <div className="text-slate-300 font-mono text-right">
            {result.frames_with_ball || result.frames.filter((f) => f.ball_detected).length}
          </div>
          <div className="text-slate-500">Trajectory confidence</div>
          <div className="text-slate-300 font-mono text-right">
            {result.trajectory_confidence
              ? `${(result.trajectory_confidence * 100).toFixed(0)}%`
              : `${Math.round(result.confidence * 100)}%`}
          </div>
          <div className="text-slate-500">Bounces detected</div>
          <div className="text-slate-300 font-mono text-right">
            {(result.bounce_points || result.trajectory.bounce_points || []).length}
          </div>
          <div className="text-slate-500">Predicted stump hit</div>
          <div className={`font-mono text-right ${
            result.predicted_stump_hit ? 'text-red-400' : 'text-blue-400'
          }`}>
            {result.predicted_stump_hit !== undefined
              ? (result.predicted_stump_hit ? 'YES' : 'NO')
              : (result.trajectory.predicted_path === 'HITTING' ? 'YES' : 'NO')}
          </div>
        </div>
      </div>
    </div>
  );
}
