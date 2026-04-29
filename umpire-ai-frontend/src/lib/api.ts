import type {
  UploadResponse,
  AnalysisResponse,
  StatusResponse,
  AnalysisResultResponse,
  FrameDataResponse,
  UploadAndAnalyzeResponse,
} from '../types';

const API_BASE = import.meta.env.VITE_API_URL || 'https://umpire-ai-backend.onrender.com';

export const api = {
  // ─── Upload video ────────────────────────────────────────
  async uploadVideo(file: File): Promise<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    const res = await fetch(`${API_BASE}/api/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Upload failed (${res.status}): ${errBody}`);
    }
    return res.json();
  },

  // ─── Start analysis ──────────────────────────────────────
  async startAnalysis(
    videoId: string,
    ballType?: string,
  ): Promise<AnalysisResponse> {
    const res = await fetch(`${API_BASE}/api/analyze/${videoId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ball_type: ballType || 'red' }),
    });
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Analysis start failed (${res.status}): ${errBody}`);
    }
    return res.json();
  },

  // ─── Get analysis status (polling) ───────────────────────
  async getAnalysisStatus(jobId: string): Promise<StatusResponse> {
    const res = await fetch(`${API_BASE}/api/analysis/${jobId}/status`);
    if (!res.ok) {
      throw new Error(`Status check failed (${res.status})`);
    }
    return res.json();
  },

  // ─── Get analysis result ─────────────────────────────────
  async getAnalysisResult(jobId: string): Promise<AnalysisResultResponse> {
    const res = await fetch(`${API_BASE}/api/analysis/${jobId}/result`);
    if (!res.ok) {
      throw new Error(`Result fetch failed (${res.status})`);
    }
    return res.json();
  },

  // ─── Get frame-by-frame data ─────────────────────────────
  async getFrameData(jobId: string): Promise<FrameDataResponse> {
    const res = await fetch(`${API_BASE}/api/analysis/${jobId}/frames`);
    if (!res.ok) {
      throw new Error(`Frame data fetch failed (${res.status})`);
    }
    return res.json();
  },

  // ─── Get annotated video URL ─────────────────────────────
  getAnnotatedVideoUrl(jobId: string): string {
    return `${API_BASE}/api/analysis/${jobId}/video`;
  },

  // ─── Upload video + start analysis (combined) ────────────
  uploadAndAnalyze(
    file: File,
    ballType: string = 'red',
    onProgress?: (progress: number) => void,
  ): Promise<UploadAndAnalyzeResponse> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('ball_type', ballType);

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch {
            reject(new Error('Invalid response from server'));
          }
        } else {
          let detail = '';
          try {
            const body = JSON.parse(xhr.responseText);
            detail = body.detail ? (Array.isArray(body.detail) ? body.detail.map((d: any) => d.msg).join(', ') : body.detail) : xhr.responseText;
          } catch {
            detail = xhr.responseText || 'Unknown error';
          }
          reject(new Error(`Upload failed (${xhr.status}): ${detail}`));
        }
      });

      xhr.addEventListener('error', () => reject(new Error('Network error during upload — check your connection or try again (server may be waking up)')));
      xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));
      xhr.addEventListener('timeout', () => reject(new Error('Upload timed out — the server may be starting up. Please try again in 30 seconds.')));

      xhr.timeout = 300000; // 5 min timeout for cold starts + large files
      xhr.open('POST', `${API_BASE}/api/upload-and-analyze`);
      xhr.send(formData);
    });
  },
};
