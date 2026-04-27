import { Shield, ShieldOff, Target, Zap } from 'lucide-react';
import { Badge } from '../common/Badge';
import type { AnalysisResultResponse } from '../../types';

interface DecisionPanelProps {
  result: AnalysisResultResponse;
}

export function DecisionPanel({ result }: DecisionPanelProps) {
  const isOut = result.decision === 'OUT';
  const confidencePct = Math.round(result.confidence * 100);

  const dismissalLabels: Record<string, string> = {
    LBW: 'Leg Before Wicket',
    BOWLED: 'Bowled',
    CAUGHT_BEHIND: 'Caught Behind',
    NOT_OUT: 'Not Out',
    NO_BALL: 'No Ball',
    WIDE: 'Wide',
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Decision Card */}
      <div
        className={`relative overflow-hidden rounded-xl border p-6 text-center animate-scale-in ${
          isOut
            ? 'border-red-500/30 bg-red-500/5 animate-pulse-glow-red'
            : 'border-emerald-500/30 bg-emerald-500/5 animate-pulse-glow-green'
        }`}
      >
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-5">
          <div
            className={`absolute inset-0 ${
              isOut ? 'bg-[radial-gradient(circle_at_center,rgba(239,68,68,0.3)_0%,transparent_70%)]' : 'bg-[radial-gradient(circle_at_center,rgba(52,211,153,0.3)_0%,transparent_70%)]'
            }`}
          />
        </div>

        <div className="relative">
          {/* Icon */}
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-800/80 border border-slate-700/50">
            {isOut ? (
              <Shield className="h-8 w-8 text-red-400" />
            ) : (
              <ShieldOff className="h-8 w-8 text-emerald-400" />
            )}
          </div>

          {/* Decision Text */}
          <div
            className={`text-4xl font-black tracking-wider animate-text-glow ${
              isOut ? 'decision-out' : 'decision-not-out'
            }`}
          >
            {result.decision}
          </div>

          {/* Dismissal Type */}
          <div className="mt-2">
            <Badge variant={isOut ? 'red' : 'emerald'}>
              {dismissalLabels[result.dismissal_type] || result.dismissal_type}
            </Badge>
          </div>

          {/* Confidence */}
          <div className="mt-4">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Target className="h-3.5 w-3.5 text-slate-500" />
              <span className="text-xs font-medium text-slate-400">Confidence</span>
            </div>
            <div className="text-2xl font-bold text-slate-100">{confidencePct}%</div>
            <div className="mt-2 mx-auto w-full max-w-[200px]">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${
                    confidencePct >= 80
                      ? 'bg-emerald-400'
                      : confidencePct >= 60
                        ? 'bg-amber-400'
                        : 'bg-red-400'
                  }`}
                  style={{ width: `${confidencePct}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Reason */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-300 mb-2">
          <Zap className="h-4 w-4 text-amber-400" />
          Decision Reason
        </h3>
        <p className="text-sm leading-relaxed text-slate-400">{result.reason}</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
          <div className="text-xs text-slate-500 mb-1">Ball Speed</div>
          <div className="text-lg font-bold text-slate-100">{result.ball_speed_kmh.toFixed(1)}</div>
          <div className="text-xs text-slate-500">km/h</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
          <div className="text-xs text-slate-500 mb-1">Deviation</div>
          <div className="text-lg font-bold text-slate-100">{result.trajectory.deviation_degrees.toFixed(1)}°</div>
          <div className="text-xs text-slate-500">swing/seam</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
          <div className="text-xs text-slate-500 mb-1">Predicted Path</div>
          <div className={`text-sm font-bold ${result.trajectory.predicted_path === 'HITTING' ? 'text-red-400' : 'text-blue-400'}`}>
            {result.trajectory.predicted_path}
          </div>
          <div className="text-xs text-slate-500">stumps</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900 p-3">
          <div className="text-xs text-slate-500 mb-1">Processing</div>
          <div className="text-lg font-bold text-slate-100">{result.processing_time_seconds.toFixed(1)}s</div>
          <div className="text-xs text-slate-500">analysis time</div>
        </div>
      </div>
    </div>
  );
}
