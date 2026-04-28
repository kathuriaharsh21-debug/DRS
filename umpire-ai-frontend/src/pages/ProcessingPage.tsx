import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Film,
  Crosshair,
  Move,
  TrendingUp,
  Map,
  Gavel,
  CheckCircle2,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { ProgressBar } from '../components/common/ProgressBar';
import { useAnalysis } from '../hooks/useAnalysis';
import { PROCESSING_STEPS } from '../lib/constants';
import type { ProcessingStep } from '../types';
import type { AnalysisStatus } from '../types';

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  Film,
  Crosshair,
  Move,
  TrendingUp,
  Map,
  Gavel,
};

export default function ProcessingPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const { status, result, analyzing, error, startPolling } = useAnalysis();
  const [mounted, setMounted] = useState(false);

  // Get stored jobId from sessionStorage
  useEffect(() => {
    if (!videoId) {
      navigate('/');
      return;
    }

    // For demo: if no real backend, simulate after a delay
    // In production, the jobId would come from the upload response
    const jobId = videoId;
    startPolling(jobId);
    setMounted(true);
  }, [videoId, navigate, startPolling]);

  // Navigate to analysis when done
  useEffect(() => {
    if (result) {
      const timer = setTimeout(() => {
        navigate(`/analysis/${result.video_id}`);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [result, navigate]);

  // Step completion logic
  const getStepState = (step: ProcessingStep, analysisStatus: AnalysisStatus | null): 'pending' | 'active' | 'completed' => {
    if (!analysisStatus) return 'pending';
    const stepIndex = PROCESSING_STEPS.findIndex((s) => s.id === step.id);
    const completedSteps = analysisStatus.steps_completed;
    if (stepIndex < completedSteps) return 'completed';
    if (stepIndex === completedSteps) return 'active';
    return 'pending';
  };

  return (
    <div className="bg-gradient-dark min-h-[calc(100vh-4rem)]">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
        {/* Header */}
        <div className="text-center mb-10 animate-fade-in-up">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 border border-amber-500/20">
            <Loader2 className="h-8 w-8 text-amber-400 animate-spin-slow" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-100">
            Analyzing Delivery
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {status?.message || 'Processing your video through the analysis pipeline...'}
          </p>
        </div>

        {/* Overall Progress */}
        <div className="mb-8 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <ProgressBar
            value={status?.progress ?? 0}
            showPercent
            size="lg"
            variant="emerald"
          />
          <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
            <span>{status?.current_step || 'Initializing...'}</span>
            <span>Step {Math.min((status?.steps_completed ?? 0) + 1, 6)} of 6</span>
          </div>
        </div>

        {/* Pipeline Steps */}
        <div className="space-y-0 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
          {PROCESSING_STEPS.map((step, index) => {
            const state = getStepState(step, status);
            const Icon = ICON_MAP[step.icon] || Film;

            return (
              <div key={step.id}>
                {/* Step */}
                <div className="flex items-start gap-4 py-3">
                  {/* Icon */}
                  <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-all duration-500 ${
                      state === 'completed'
                        ? 'bg-emerald-500/15 border border-emerald-500/30'
                        : state === 'active'
                          ? 'bg-amber-500/15 border border-amber-500/30'
                          : 'bg-slate-800/50 border border-slate-800'
                    }`}
                  >
                    {state === 'completed' ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                    ) : state === 'active' ? (
                      <div className="relative">
                        <Icon className="h-5 w-5 text-amber-400" />
                        <div className="absolute inset-0 animate-ping">
                          <Icon className="h-5 w-5 text-amber-400 opacity-30" />
                        </div>
                      </div>
                    ) : (
                      <Icon className="h-5 w-5 text-slate-600" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3
                        className={`text-sm font-semibold transition-colors ${
                          state === 'completed'
                            ? 'text-emerald-400'
                            : state === 'active'
                              ? 'text-amber-400'
                              : 'text-slate-600'
                        }`}
                      >
                        {step.label}
                      </h3>
                      {state === 'active' && (
                        <span className="text-xs text-amber-400/70">Processing...</span>
                      )}
                      {state === 'completed' && (
                        <span className="text-xs text-emerald-400/70">Done</span>
                      )}
                    </div>
                    <p
                      className={`mt-0.5 text-xs transition-colors ${
                        state === 'pending' ? 'text-slate-700' : 'text-slate-500'
                      }`}
                    >
                      {step.description}
                    </p>

                    {/* Step progress bar when active */}
                    {state === 'active' && (
                      <div className="mt-2">
                        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800 animate-shimmer" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Connector */}
                {index < PROCESSING_STEPS.length - 1 && (
                  <div className="flex justify-start pl-[1.95rem]">
                    <div
                      className={`w-0.5 h-6 transition-colors duration-500 ${
                        state === 'completed'
                          ? 'bg-emerald-500/40'
                          : 'bg-slate-800/50'
                      }`}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Error State */}
        {error && (
          <div className="mt-8 flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/5 p-4 animate-fade-in-up">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            <div>
              <p className="text-sm font-medium text-red-400">Analysis Failed</p>
              <p className="mt-1 text-sm text-red-400/70">{error}</p>
              <button
                onClick={() => navigate('/')}
                className="mt-3 text-xs font-medium text-red-300 hover:text-red-200 underline"
              >
                Return to upload
              </button>
            </div>
          </div>
        )}

        {/* Completion State */}
        {result && (
          <div className="mt-8 flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 animate-scale-in">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
            <div>
              <p className="text-sm font-medium text-emerald-400">Analysis Complete!</p>
              <p className="mt-1 text-sm text-emerald-400/70">
                Redirecting to results...
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
