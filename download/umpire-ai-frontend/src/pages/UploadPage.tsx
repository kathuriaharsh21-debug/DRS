import { useNavigate } from 'react-router-dom';
import { Crosshair, TrendingUp, Gavel, Zap } from 'lucide-react';
import { VideoUploader } from '../components/upload/VideoUploader';
import { useVideoUpload } from '../hooks/useVideoUpload';

const FEATURES = [
  {
    icon: Crosshair,
    title: 'Ball Detection',
    description: 'HSV color space analysis with contour detection for precise ball tracking in every frame.',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
  },
  {
    icon: TrendingUp,
    title: '3D Trajectory',
    description: 'Kalman filter-based trajectory estimation with perspective transform to pitch coordinates.',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
  },
  {
    icon: Gavel,
    title: 'Decision Engine',
    description: 'Rule-based analysis engine for LBW, Bowled, and Caught Behind dismissal decisions.',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
  },
];

export default function UploadPage() {
  const navigate = useNavigate();
  const { uploading, progress, videoId, error, upload, reset } = useVideoUpload();

  const handleUpload = async (file: File, ballType: string) => {
    const resultVideoId = await upload(file, ballType as 'red' | 'white' | 'pink');
    if (resultVideoId) {
      navigate(`/processing/${resultVideoId}`);
    }
    return resultVideoId;
  };

  return (
    <div className="bg-gradient-dark min-h-[calc(100vh-4rem)]">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 py-12 sm:py-20">
        {/* Hero Section */}
        <div className="text-center mb-12 sm:mb-16 animate-fade-in-up">
          {/* Logo */}
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500/20 to-emerald-700/20 border border-emerald-500/20 shadow-xl shadow-emerald-500/5 animate-float">
            <Zap className="h-10 w-10 text-emerald-400" />
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight text-slate-50">
            Umpire <span className="text-emerald-400">AI</span>
          </h1>
          <p className="mt-4 text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto">
            Cricket ball trajectory analysis powered by computer vision.
            Upload a delivery clip to get instant LBW and dismissal predictions.
          </p>
        </div>

        {/* Feature Cards */}
        <div className="mb-12 sm:mb-16 grid grid-cols-1 sm:grid-cols-3 gap-4 stagger-children">
          {FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 card-hover animate-fade-in-up opacity-0"
            >
              <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${feature.bg}`}>
                <feature.icon className={`h-5 w-5 ${feature.color}`} />
              </div>
              <h3 className="text-sm font-semibold text-slate-200">{feature.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{feature.description}</p>
            </div>
          ))}
        </div>

        {/* Upload Section */}
        <div className="animate-fade-in-up" style={{ animationDelay: '400ms' }}>
          <VideoUploader
            onUpload={handleUpload}
            uploading={uploading}
            progress={progress}
            error={error}
            onReset={reset}
          />
        </div>

        {/* Footer Info */}
        <div className="mt-12 text-center">
          <p className="text-xs text-slate-600">
            Supports MP4, WebM, MOV, AVI formats up to 500MB.
            Video processing happens entirely on the server — nothing is stored permanently.
          </p>
        </div>
      </div>
    </div>
  );
}
