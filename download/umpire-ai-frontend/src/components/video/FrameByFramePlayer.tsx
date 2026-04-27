import { useRef, useEffect, useMemo } from 'react';
import { useFramePlayer } from '../../hooks/useFramePlayer';
import { TrajectoryCanvas } from '../analysis/TrajectoryCanvas';
import { VideoControls } from './VideoControls';
import type { FrameDataPoint, TrajectoryPoint } from '../../types';

interface FrameByFramePlayerProps {
  videoSrc: string;
  frames: FrameDataPoint[];
  trajectoryPoints: TrajectoryPoint[];
  fps?: number;
}

export function FrameByFramePlayer({
  videoSrc,
  frames,
  trajectoryPoints,
  fps = 30,
}: FrameByFramePlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const player = useFramePlayer(videoRef, fps);

  // Build frame lookup map
  const frameLookup = useMemo(() => {
    const map = new Map<number, FrameDataPoint>();
    for (const frame of frames) {
      map.set(frame.frame_number, frame);
    }
    return map;
  }, [frames]);

  // Get trajectory points up to current frame
  const visibleTrajectoryPoints = useMemo(() => {
    return trajectoryPoints.filter((p) => p.frame_number <= player.currentFrame);
  }, [trajectoryPoints, player.currentFrame]);

  // Get current frame data
  const currentFrameData = useMemo(() => {
    return frameLookup.get(player.currentFrame) || null;
  }, [frameLookup, player.currentFrame]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when typing in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          player.togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          player.stepBackward();
          break;
        case 'ArrowRight':
          e.preventDefault();
          player.stepForward();
          break;
        case 'ArrowUp':
          e.preventDefault();
          player.goToFrame(Math.min(player.currentFrame + 10, player.totalFrames));
          break;
        case 'ArrowDown':
          e.preventDefault();
          player.goToFrame(Math.max(player.currentFrame - 10, 0));
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [player]);

  return (
    <div className="flex flex-col gap-2">
      {/* Video + Canvas Container */}
      <div className="video-container relative aspect-video bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          src={videoSrc}
          className="w-full h-full object-contain"
          playsInline
          preload="auto"
          crossOrigin="anonymous"
        />

        {/* Trajectory Overlay */}
        <TrajectoryCanvas
          points={visibleTrajectoryPoints}
          currentBallPosition={currentFrameData?.ball_position ?? null}
          width={0}
          height={0}
          containerRef={videoRef}
          currentFrame={player.currentFrame}
          totalFrames={player.totalFrames}
        />

        {/* Frame Info Overlay */}
        <div className="absolute top-2 left-2 flex items-center gap-2">
          <div className="rounded-md bg-black/70 px-2 py-1 text-xs font-mono text-emerald-400 backdrop-blur-sm border border-slate-700/30">
            F{player.currentFrame}
          </div>
          {currentFrameData?.ball_detected && (
            <div className="rounded-md bg-black/70 px-2 py-1 text-xs backdrop-blur-sm border border-emerald-500/30">
              <span className="text-amber-400">
                ● Ball ({Math.round(currentFrameData.confidence * 100)}%)
              </span>
            </div>
          )}
        </div>

        {/* Keyboard Shortcuts Hint */}
        <div className="absolute bottom-2 right-2 hidden sm:flex items-center gap-1 rounded-md bg-black/50 px-2 py-1 text-[10px] text-slate-500 backdrop-blur-sm">
          <kbd className="rounded bg-slate-800 px-1">←→</kbd> Step
          <kbd className="rounded bg-slate-800 px-1 ml-1">Space</kbd> Play
        </div>
      </div>

      {/* Controls */}
      <VideoControls player={player} />
    </div>
  );
}
