import {
  Gauge,
  Activity,
  Compass,
  MapPin,
  Layers,
  Timer,
  Crosshair,
  TrendingUp,
  Cpu,
  Eye,
  GitBranch,
  Cog,
} from 'lucide-react';
import type { AnalysisResultResponse } from '../../types';

interface StatsPanelProps {
  result: AnalysisResultResponse;
}

export function StatsPanel({ result }: StatsPanelProps) {
  const speed = result.ball_speed_kmh;
  const deviation = result.trajectory.deviation_degrees;
  const confidence = Math.round(result.confidence * 100);
  const totalFrames = result.frames.length;
  const detectedFrames = result.frames.filter((f) => f.ball_detected).length;
  const avgConfidence =
    result.frames.length > 0
      ? result.frames.reduce((sum, f) => sum + f.confidence, 0) / result.frames.length
      : 0;
  const bounceCount = result.trajectory.bounce_points?.length || result.bounce_points?.length || 0;
  const pipeline = result.pipeline;

  const stats = [
    {
      icon: Gauge,
      label: 'Ball Speed',
      value: `${speed.toFixed(1)} km/h`,
      sublabel: speed >= 140 ? 'Fast' : speed >= 120 ? 'Medium-Fast' : speed >= 100 ? 'Medium' : 'Slow',
      color: speed >= 140 ? 'text-red-400' : speed >= 120 ? 'text-amber-400' : 'text-emerald-400',
    },
    {
      icon: Compass,
      label: 'Deviation',
      value: `${Math.abs(deviation).toFixed(1)}°`,
      sublabel: deviation > 0 ? 'Away swing' : deviation < 0 ? 'Into swing' : 'Straight',
      color: 'text-amber-400',
    },
    {
      icon: Crosshair,
      label: 'Detection Rate',
      value: `${totalFrames > 0 ? Math.round((detectedFrames / totalFrames) * 100) : 0}%`,
      sublabel: `${detectedFrames}/${totalFrames} frames`,
      color: detectedFrames / totalFrames > 0.8 ? 'text-emerald-400' : 'text-amber-400',
    },
    {
      icon: Activity,
      label: 'Avg Confidence',
      value: `${(avgConfidence * 100).toFixed(0)}%`,
      sublabel: avgConfidence > 0.9 ? 'High' : avgConfidence > 0.7 ? 'Medium' : 'Low',
      color: avgConfidence > 0.9 ? 'text-emerald-400' : avgConfidence > 0.7 ? 'text-amber-400' : 'text-red-400',
    },
    {
      icon: TrendingUp,
      label: 'Predicted Path',
      value: result.trajectory.predicted_path,
      sublabel: result.trajectory.predicted_path === 'HITTING' ? 'Would hit stumps' : 'Would miss stumps',
      color: result.trajectory.predicted_path === 'HITTING' ? 'text-red-400' : 'text-blue-400',
    },
    {
      icon: Timer,
      label: 'Analysis Time',
      value: `${result.processing_time_seconds.toFixed(2)}s`,
      sublabel: 'Total processing',
      color: 'text-slate-300',
    },
  ];

  return (
    <div className="space-y-4">
      {/* v2 Pipeline Tier Badges */}
      {pipeline && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
            <Cpu className="h-4 w-4 text-violet-400" />
            Pipeline Configuration
          </h3>
          <div className="grid grid-cols-3 gap-2">
            <TierBadge
              icon={Eye}
              label="Detection"
              value={formatTier(pipeline.detection_tier)}
              color={pipeline.detection_tier === 'yolo' ? 'emerald' : 'amber'}
            />
            <TierBadge
              icon={GitBranch}
              label="Tracking"
              value={formatTier(pipeline.tracking_tier)}
              color={pipeline.tracking_tier === 'botsort' ? 'emerald' : 'amber'}
            />
            <TierBadge
              icon={Cog}
              label="Trajectory"
              value={pipeline.trajectory_filter === 'ukf' ? 'UKF+Physics' : 'Linear KF'}
              color={pipeline.trajectory_filter === 'ukf' ? 'emerald' : 'amber'}
            />
          </div>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-slate-800 bg-slate-900 p-3 card-hover"
          >
            <div className="flex items-center gap-2 mb-2">
              <stat.icon className="h-4 w-4 text-slate-500" />
              <span className="text-xs font-medium text-slate-500">{stat.label}</span>
            </div>
            <div className={`text-lg font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-slate-600 mt-0.5">{stat.sublabel}</div>
          </div>
        ))}
      </div>

      {/* Detailed Info */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
          <Layers className="h-4 w-4 text-emerald-400" />
          Trajectory Details
        </h3>
        <div className="space-y-2">
          <InfoRow
            icon={MapPin}
            label="Pitch Point"
            value={
              result.trajectory.pitch_point
                ? `(${result.trajectory.pitch_point.x.toFixed(3)}, ${result.trajectory.pitch_point.y.toFixed(3)})`
                : 'Not detected'
            }
          />
          <InfoRow
            icon={MapPin}
            label="Impact Point"
            value={
              result.trajectory.impact_point
                ? `(${result.trajectory.impact_point.x.toFixed(3)}, ${result.trajectory.impact_point.y.toFixed(3)})`
                : 'Not detected'
            }
          />
          <InfoRow
            icon={Crosshair}
            label="Bounces Detected"
            value={bounceCount > 0 ? `${bounceCount} bounce${bounceCount > 1 ? 's' : ''}` : 'None'}
          />
          <InfoRow
            icon={Compass}
            label="Swing/Seam Movement"
            value={`${deviation.toFixed(2)}°`}
          />
          <InfoRow
            icon={Layers}
            label="Trajectory Points"
            value={`${result.trajectory.points.length} points tracked`}
          />
          {result.predicted_stump_hit !== undefined && (
            <InfoRow
              icon={TrendingUp}
              label="Stump Hit Prediction"
              value={result.predicted_stump_hit ? 'HITTING' : 'MISSING'}
              valueColor={result.predicted_stump_hit ? 'text-red-400' : 'text-blue-400'}
            />
          )}
        </div>
      </div>

      {/* Dismissal Analysis */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-3">
          <Crosshair className="h-4 w-4 text-amber-400" />
          Dismissal Analysis
        </h3>
        <p className="text-sm leading-relaxed text-slate-400">{result.reason}</p>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-slate-500">Confidence:</span>
          <div className="flex-1 max-w-[150px] h-1.5 rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full ${
                confidence >= 80
                  ? 'bg-emerald-400'
                  : confidence >= 60
                    ? 'bg-amber-400'
                    : 'bg-red-400'
              }`}
              style={{ width: `${confidence}%` }}
            />
          </div>
          <span className={`text-xs font-bold ${
            confidence >= 80
              ? 'text-emerald-400'
              : confidence >= 60
                ? 'text-amber-400'
                : 'text-red-400'
          }`}>
            {confidence}%
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────

function TierBadge({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.FC<{ className?: string }>;
  label: string;
  value: string;
  color: 'emerald' | 'amber';
}) {
  const borderColor = color === 'emerald' ? 'border-emerald-500/20' : 'border-amber-500/20';
  const textColor = color === 'emerald' ? 'text-emerald-400' : 'text-amber-400';
  const bgColor = color === 'emerald' ? 'bg-emerald-500/5' : 'bg-amber-500/5';

  return (
    <div className={`rounded-lg border ${borderColor} ${bgColor} p-2 text-center`}>
      <div className="flex items-center justify-center gap-1 mb-1">
        <Icon className={`h-3 w-3 ${textColor}`} />
        <span className="text-[10px] text-slate-500">{label}</span>
      </div>
      <div className={`text-xs font-bold ${textColor}`}>{value}</div>
    </div>
  );
}

function formatTier(tier: string): string {
  const map: Record<string, string> = {
    yolo: 'YOLOv11+P2',
    classical: 'HSV+MOG2',
    auto: 'Auto',
    botsort: 'BoT-SORT',
    ukf: 'UKF+Physics',
    linear_kf: 'Linear KF',
  };
  return map[tier] || tier;
}

function InfoRow({
  icon: Icon,
  label,
  value,
  valueColor,
}: {
  icon: React.FC<{ className?: string }>;
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 border-b border-slate-800/50 last:border-0">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <span className={`text-xs font-mono ${valueColor || 'text-slate-300'}`}>{value}</span>
    </div>
  );
}
