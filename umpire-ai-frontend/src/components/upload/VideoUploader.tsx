import { useState, useRef, useCallback, type DragEvent } from 'react';
import { Upload, Film, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { BallType } from '../../types';

interface VideoUploaderProps {
  onUpload: (file: File, ballType: string) => Promise<string | null>;
  uploading: boolean;
  progress: number;
  error: string | null;
  onReset: () => void;
}

const BALL_TYPES: { value: BallType; label: string; color: string }[] = [
  { value: 'red', label: 'Red', color: 'bg-red-500' },
  { value: 'white', label: 'White', color: 'bg-white' },
  { value: 'pink', label: 'Pink', color: 'bg-pink-400' },
];

const ACCEPTED_FORMATS = '.mp4,.webm,.mov,.avi,.mkv';
const MAX_SIZE_MB = 500;

export function VideoUploader({
  onUpload,
  uploading,
  progress,
  error,
  onReset,
}: VideoUploaderProps) {
  const [dragOver, setDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [ballType, setBallType] = useState<BallType>('red');
  const [uploadComplete, setUploadComplete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDrag = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragOver(true);
    } else if (e.type === 'dragleave') {
      setDragOver(false);
    }
  }, []);

  const validateFile = useCallback((file: File): string | null => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    const validExts = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
    if (!ext || !validExts.includes(ext)) {
      return `Invalid format: .${ext}. Supported: MP4, WebM, MOV, AVI, MKV`;
    }
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > MAX_SIZE_MB) {
      return `File too large: ${sizeMB.toFixed(1)}MB. Maximum: ${MAX_SIZE_MB}MB`;
    }
    return null;
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      setUploadComplete(false);
      const file = e.dataTransfer.files[0];
      if (file) {
        const validationError = validateFile(file);
        if (validationError) {
          onReset();
          return;
        }
        setSelectedFile(file);
      }
    },
    [validateFile, onReset],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        setUploadComplete(false);
        const validationError = validateFile(file);
        if (validationError) {
          onReset();
          return;
        }
        setSelectedFile(file);
      }
    },
    [validateFile, onReset],
  );

  const handleUpload = useCallback(async () => {
    if (!selectedFile) return;
    const result = await onUpload(selectedFile, ballType);
    if (result) {
      setUploadComplete(true);
    }
  }, [selectedFile, ballType, onUpload]);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      {!selectedFile && !uploading && !uploadComplete && (
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`
            relative cursor-pointer rounded-2xl border-2 border-dashed p-8 sm:p-12
            transition-all duration-300 ease-out
            ${dragOver
              ? 'border-emerald-400 bg-emerald-500/10 scale-[1.02] shadow-lg shadow-emerald-500/10'
              : 'border-slate-700 bg-slate-900/50 hover:border-slate-500 hover:bg-slate-900/80'
            }
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_FORMATS}
            onChange={handleFileSelect}
            className="hidden"
          />
          <div className="flex flex-col items-center text-center">
            <div className={`
              mb-4 flex h-16 w-16 items-center justify-center rounded-2xl
              transition-all duration-300
              ${dragOver
                ? 'bg-emerald-500/20 text-emerald-400 scale-110'
                : 'bg-slate-800 text-slate-400'
              }
            `}>
              <Upload className="h-8 w-8" />
            </div>
            <h3 className="text-lg font-semibold text-slate-200 mb-1">
              {dragOver ? 'Drop your video here' : 'Upload a delivery clip'}
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              Drag and drop or click to browse
            </p>
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <Film className="h-3.5 w-3.5" />
              <span>MP4, WebM, MOV, AVI, MKV up to {MAX_SIZE_MB}MB</span>
            </div>
          </div>
        </div>
      )}

      {selectedFile && !uploading && !uploadComplete && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-6 space-y-5">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-800">
              <Film className="h-6 w-6 text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">
                {selectedFile.name}
              </p>
              <p className="text-xs text-slate-500">
                {formatFileSize(selectedFile.size)}
              </p>
            </div>
            <button
              onClick={() => {
                setSelectedFile(null);
                onReset();
              }}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Remove
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-2">
              Ball Type
            </label>
            <div className="flex gap-2">
              {BALL_TYPES.map((bt) => (
                <button
                  key={bt.value}
                  onClick={() => setBallType(bt.value)}
                  className={`
                    flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium
                    transition-all duration-200 border
                    ${ballType === bt.value
                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 shadow-sm shadow-emerald-500/10'
                      : 'border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600'
                    }
                  `}
                >
                  <span
                    className={`h-3 w-3 rounded-full ${bt.color} ${
                      bt.value === 'white' ? 'ring-1 ring-slate-400' : ''
                    }`}
                  />
                  {bt.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleUpload}
            className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-6 py-3
              text-sm font-semibold text-white shadow-lg shadow-emerald-500/20
              hover:from-emerald-500 hover:to-emerald-400 hover:shadow-emerald-500/30
              active:scale-[0.98] transition-all duration-200"
          >
            Analyze Delivery
          </button>
        </div>
      )}

      {uploading && (
        <div className="rounded-2xl border border-emerald-500/20 bg-slate-900/80 p-6 space-y-4">
          <div className="flex items-center gap-3">
            <Loader2 className="h-5 w-5 text-emerald-400 animate-spin" />
            <div>
              <p className="text-sm font-medium text-slate-200">Processing video...</p>
              <p className="text-xs text-slate-500 mt-0.5">
                {selectedFile?.name}
              </p>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-slate-400">Uploading</span>
              <span className="text-emerald-400 font-medium">{progress}%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400
                  transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {uploadComplete && (
        <div className="rounded-2xl border border-emerald-500/20 bg-slate-900/80 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-emerald-400">Upload complete!</p>
              <p className="text-xs text-slate-500">Redirecting to analysis...</p>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-medium text-red-400">Upload failed</p>
              <p className="text-xs text-slate-500 mt-1">{error}</p>
              <button
                onClick={onReset}
                className="mt-2 text-xs text-slate-400 hover:text-slate-200 transition-colors"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
