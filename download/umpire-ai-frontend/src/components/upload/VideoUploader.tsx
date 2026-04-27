import { useState, useRef, useCallback, type DragEvent, type ChangeEvent } from 'react';
import { Upload, Film, AlertCircle, CheckCircle, X } from 'lucide-react';
import { ProgressBar } from '../common/ProgressBar';
import { ACCEPTED_EXTENSIONS, ACCEPTED_VIDEO_TYPES, MAX_FILE_SIZE_MB } from '../../lib/constants';
import type { BallType } from '../../types';

interface VideoUploaderProps {
  onUpload: (file: File, ballType: BallType) => Promise<string | null>;
  uploading: boolean;
  progress: number;
  error: string | null;
  onReset: () => void;
}

const BALL_TYPES: { value: BallType; label: string; color: string; bg: string; border: string }[] = [
  { value: 'red', label: 'Red Ball', color: 'bg-red-500', bg: 'bg-red-500/10', border: 'border-red-500/30' },
  { value: 'white', label: 'White Ball', color: 'bg-white', bg: 'bg-white/10', border: 'border-white/30' },
  { value: 'pink', label: 'Pink Ball', color: 'bg-pink-400', bg: 'bg-pink-400/10', border: 'border-pink-400/30' },
];

export function VideoUploader({ onUpload, uploading, progress, error, onReset }: VideoUploaderProps) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [ballType, setBallType] = useState<BallType>('red');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = useCallback((file: File): string | null => {
    if (!ACCEPTED_VIDEO_TYPES.includes(file.type) && !file.name.match(/\.(mp4|webm|mov|avi|mkv)$/i)) {
      return 'Unsupported format. Please upload MP4, WebM, MOV, AVI, or MKV.';
    }
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > MAX_FILE_SIZE_MB) {
      return `File too large (${sizeMB.toFixed(1)}MB). Maximum is ${MAX_FILE_SIZE_MB}MB.`;
    }
    if (sizeMB < 0.1) {
      return 'File too small. Please upload a valid video.';
    }
    return null;
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      setValidationError(null);
      setUploadComplete(false);

      const err = validateFile(file);
      if (err) {
        setValidationError(err);
        return;
      }

      setSelectedFile(file);
      // Create preview URL
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoUrl(URL.createObjectURL(file));
    },
    [validateFile, videoUrl],
  );

  const handleDrag = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleInputChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      // Reset input so re-selecting same file works
      if (inputRef.current) inputRef.current.value = '';
    },
    [handleFile],
  );

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;
    const videoId = await onUpload(selectedFile, ballType);
    if (videoId) {
      setUploadComplete(true);
    }
  }, [selectedFile, ballType, onUpload]);

  const handleRemoveFile = useCallback(() => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setSelectedFile(null);
    setVideoUrl(null);
    setValidationError(null);
    setUploadComplete(false);
    onReset();
  }, [videoUrl, onReset]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      {/* Ball Type Selector */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-400 mb-2">Ball Type</label>
        <div className="flex gap-2">
          {BALL_TYPES.map((bt) => (
            <button
              key={bt.value}
              onClick={() => setBallType(bt.value)}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all ${
                ballType === bt.value
                  ? `${bt.bg} ${bt.border} text-slate-100`
                  : 'border-slate-700 bg-slate-900 text-slate-500 hover:border-slate-600 hover:text-slate-300'
              }`}
            >
              <span className={`h-3 w-3 rounded-full ${bt.color} shadow-sm`} />
              {bt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Drop Zone */}
      {!selectedFile && (
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`group relative cursor-pointer rounded-xl border-2 border-dashed p-8 sm:p-12 transition-all duration-300 ${
            dragActive
              ? 'border-emerald-400 bg-emerald-500/5 dropzone-active'
              : 'border-slate-700 bg-slate-900/50 hover:border-slate-500 hover:bg-slate-900'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_EXTENSIONS}
            onChange={handleInputChange}
            className="hidden"
          />
          <div className="flex flex-col items-center gap-4 text-center">
            <div
              className={`flex h-16 w-16 items-center justify-center rounded-2xl transition-all duration-300 ${
                dragActive
                  ? 'bg-emerald-500/20 scale-110'
                  : 'bg-slate-800 group-hover:bg-slate-700'
              }`}
            >
              <Upload className="h-8 w-8 text-slate-400 group-hover:text-emerald-400 transition-colors dropzone-icon" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-200">
                {dragActive ? 'Drop your video here' : 'Drag & drop a video clip'}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                or <span className="text-emerald-400 hover:text-emerald-300">browse files</span>
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-1.5 text-xs text-slate-600">
              {['MP4', 'WebM', 'MOV', 'AVI', 'MKV'].map((fmt) => (
                <span key={fmt} className="rounded bg-slate-800 px-2 py-0.5">
                  {fmt}
                </span>
              ))}
              <span className="text-slate-600">•</span>
              <span>Max {MAX_FILE_SIZE_MB}MB</span>
            </div>
          </div>
        </div>
      )}

      {/* File Selected / Preview */}
      {selectedFile && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden animate-scale-in">
          {/* Video Preview Thumbnail */}
          {videoUrl && (
            <div className="relative aspect-video bg-black">
              <video
                src={videoUrl}
                className="w-full h-full object-contain"
                muted
                preload="metadata"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent pointer-events-none" />
              {!uploading && !uploadComplete && (
                <button
                  onClick={handleRemoveFile}
                  className="absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/80 text-slate-400 hover:bg-red-500/80 hover:text-white transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {/* File Info */}
          <div className="p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-800">
                <Film className="h-5 w-5 text-slate-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-200 truncate">{selectedFile.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{formatSize(selectedFile.size)}</p>
              </div>
              {uploadComplete && (
                <div className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle className="h-4 w-4" />
                  <span className="text-xs font-medium">Ready</span>
                </div>
              )}
            </div>

            {/* Upload Progress */}
            {uploading && (
              <div className="mt-3">
                <ProgressBar value={progress} showPercent size="sm" />
                <p className="mt-1 text-xs text-slate-500">
                  {progress < 100 ? 'Uploading and starting analysis...' : 'Processing upload...'}
                </p>
              </div>
            )}

            {/* Action Buttons */}
            {!uploadComplete && !uploading && (
              <div className="mt-4 flex gap-2">
                <button
                  onClick={handleUpload}
                  className="flex-1 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition-all hover:bg-emerald-400 hover:shadow-lg hover:shadow-emerald-500/25 active:scale-[0.98]"
                >
                  Analyze Video
                </button>
                <button
                  onClick={handleRemoveFile}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-medium text-slate-400 transition-all hover:border-slate-600 hover:text-slate-200"
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Validation Error */}
      {validationError && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3 animate-fade-in-up">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <p className="text-sm text-red-400">{validationError}</p>
        </div>
      )}

      {/* Upload Error */}
      {error && !validationError && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-3 animate-fade-in-up">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
          <div>
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={handleRemoveFile}
              className="mt-1 text-xs text-red-300 hover:text-red-200 underline"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
