import { useState, useCallback } from 'react';
import { api } from '../lib/api';
import type { BallType } from '../types';

interface UseVideoUploadReturn {
  uploading: boolean;
  progress: number;
  videoId: string | null;
  jobId: string | null;
  error: string | null;
  upload: (file: File, ballType?: BallType) => Promise<string | null>;
  reset: () => void;
}

export function useVideoUpload(): UseVideoUploadReturn {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File, ballType: BallType = 'red'): Promise<string | null> => {
      setUploading(true);
      setProgress(0);
      setError(null);
      setVideoId(null);
      setJobId(null);

      try {
        const response = await api.uploadAndAnalyze(file, ballType, (p) => {
          setProgress(p);
        });

        setVideoId(response.video_id);
        setJobId(response.job_id);
        return response.video_id;
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Upload failed. Please try again.';
        setError(message);
        return null;
      } finally {
        setUploading(false);
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setUploading(false);
    setProgress(0);
    setVideoId(null);
    setJobId(null);
    setError(null);
  }, []);

  return { uploading, progress, videoId, jobId, error, upload, reset };
}
