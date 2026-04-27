import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { AnalysisDashboard } from '../components/analysis/AnalysisDashboard';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { api } from '../lib/api';
import { DEFAULT_FPS } from '../lib/constants';
import type { AnalysisResultResponse } from '../types';

export default function AnalysisPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<AnalysisResultResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Try to find the result from the API
  useEffect(() => {
    if (!videoId) {
      navigate('/');
      return;
    }

    let cancelled = false;

    async function fetchResult() {
      try {
        setLoading(true);
        // The jobId is the same as videoId for the upload-and-analyze endpoint
        const res = await api.getAnalysisResult(videoId);
        if (!cancelled) {
          setResult(res);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError('Failed to load analysis results. The analysis may still be processing.');
          setLoading(false);
        }
      }
    }

    fetchResult();

    return () => {
      cancelled = true;
    };
  }, [videoId, navigate]);

  // Create a blob URL for the uploaded video
  // In production, you'd get this from the backend or stored state
  const videoUrl = useMemo(() => {
    // Check if we have a stored video URL in sessionStorage
    const stored = sessionStorage.getItem(`video-url-${videoId}`);
    if (stored) return stored;

    // Fallback: generate a demo video URL
    // In production, this would come from the upload response
    return '';
  }, [videoId]);

  if (loading) {
    return (
      <div className="bg-gradient-dark min-h-[calc(100vh-4rem)] flex items-center justify-center">
        <LoadingSpinner size="lg" label="Loading analysis results..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-gradient-dark min-h-[calc(100vh-4rem)] flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10 border border-red-500/20">
            <svg className="h-8 w-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-200">Results Not Available</h2>
          <p className="mt-2 text-sm text-slate-500">{error}</p>
          <div className="mt-6 flex gap-3 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400 transition-colors"
            >
              Retry
            </button>
            <button
              onClick={() => navigate('/')}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:border-slate-600 transition-colors"
            >
              New Analysis
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!result) {
    return null;
  }

  return (
    <div className="bg-gradient-dark">
      <AnalysisDashboard result={result} videoUrl={videoUrl} />
    </div>
  );
}
