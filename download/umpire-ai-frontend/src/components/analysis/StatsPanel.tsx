import {
  Gauge,
  Activity,
  Compass,
  MapPin,
  Layers,
  Timer,
  Crosshair,
  TrendingUp,
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
      label: 'Avg Detection Confidence',
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
                ? `(${result.trajectory.pitch_point.x.toFixed(1)}, ${result.trajectory.pitch_point.y.toFixed(1)})`
                : 'Not detected'
            }
          />
          <InfoRow
            icon={MapPin}
            label="Impact Point"
            value={
              result.trajectory.impact_point
                ? `(${result.trajectory.impact_point.x.toFixed(1)}, ${result.trajectory.impact_point.y.toFixed(1)})`
                : 'Not detected'
            }
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

// ─── Sub-component ─────────────────────────────────────────

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.FC<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 border-b border-slate-800/50 last:border-0">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <span className="text-xs font-mono text-slate-300">{value}</span>
    </div>
  );
}
