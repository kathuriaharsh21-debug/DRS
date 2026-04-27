import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import type { AnalysisStatus, AnalysisResultResponse, JobStatus } from '../types';

interface UseAnalysisReturn {
  status: AnalysisStatus | null;
  result: AnalysisResultResponse | null;
  analyzing: boolean;
  error: string | null;
  startPolling: (jobId: string) => void;
  stopPolling: () => void;
  reset: () => void;
}

const POLL_INTERVAL_MS = 1500;

export function useAnalysis(): UseAnalysisReturn {
  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [result, setResult] = useState<AnalysisResultResponse | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jobIdRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setAnalyzing(false);
  }, []);

  const fetchResult = useCallback(async (jId: string) => {
    try {
      const res = await api.getAnalysisResult(jId);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch result');
    }
  }, []);

  const pollStatus = useCallback(
    async (jId: string) => {
      try {
        const res = await api.getAnalysisStatus(jId);
        setStatus({
          job_id: res.job_id,
          status: res.status,
          progress: res.progress,
          current_step: res.current_step,
          steps_completed: res.steps_completed,
          total_steps: res.total_steps,
          message: res.message,
        });

        if (res.status === 'completed') {
          stopPolling();
          await fetchResult(jId);
        } else if (res.status === 'failed') {
          stopPolling();
          setError(res.message || 'Analysis failed');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Status check failed');
        stopPolling();
      }
    },
    [stopPolling, fetchResult],
  );

  const startPolling = useCallback(
    (jId: string) => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }

      jobIdRef.current = jId;
      setAnalyzing(true);
      setError(null);
      setResult(null);

      // Immediately poll once
      pollStatus(jId);

      // Then poll on interval
      intervalRef.current = setInterval(() => {
        pollStatus(jId);
      }, POLL_INTERVAL_MS);
    },
    [pollStatus],
  );

  const reset = useCallback(() => {
    stopPolling();
    setStatus(null);
    setResult(null);
    setError(null);
    jobIdRef.current = null;
  }, [stopPolling]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return { status, result, analyzing, error, startPolling, stopPolling, reset };
}
