import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  RotateCw,
  Gauge,
} from 'lucide-react';
import { PLAYBACK_SPEEDS } from '../../lib/constants';
import type { UseFramePlayerReturn } from '../../hooks/useFramePlayer';

interface VideoControlsProps {
  player: UseFramePlayerReturn;
}

export function VideoControls({ player }: VideoControlsProps) {
  const {
    currentFrame,
    totalFrames,
    currentTime,
    duration,
    isPlaying,
    playbackSpeed,
    stepForward,
    stepBackward,
    togglePlay,
    setPlaybackSpeed,
    goToTime,
    loopStart,
    loopEnd,
    setLoopStart,
    setLoopEnd,
    clearLoop,
  } = player;

  const formatTime = (t: number) => {
    const mins = Math.floor(t / 60);
    const secs = Math.floor(t % 60);
    const frames = Math.floor((t % 1) * 30);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    goToTime(pct * duration);
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const hasLoop = loopStart !== null && loopEnd !== null;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/90 p-3 backdrop-blur-sm">
      {/* Timeline Scrubber */}
      <div
        className="group relative mb-3 cursor-pointer py-1"
        onClick={handleSeek}
        role="slider"
        aria-label="Video timeline"
        aria-valuenow={currentFrame}
        aria-valuemin={0}
        aria-valuemax={totalFrames}
        tabIndex={0}
      >
        {/* Track */}
        <div className="h-1.5 w-full rounded-full bg-slate-800 transition-all group-hover:h-2">
          {/* Progress */}
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 relative"
            style={{ width: `${progressPct}%` }}
          >
            <div className="absolute right-0 top-1/2 h-3 w-3 -translate-y-1/2 translate-x-1/2 rounded-full bg-emerald-400 opacity-0 shadow-lg shadow-emerald-400/30 transition-opacity group-hover:opacity-100" />
          </div>
        </div>

        {/* Loop markers */}
        {loopStart !== null && (
          <div
            className="absolute top-0 h-full w-0.5 bg-amber-400/80 z-10"
            style={{ left: `${(loopStart / totalFrames) * 100}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-[10px] text-amber-400 whitespace-nowrap">
              IN
            </div>
          </div>
        )}
        {loopEnd !== null && (
          <div
            className="absolute top-0 h-full w-0.5 bg-amber-400/80 z-10"
            style={{ left: `${(loopEnd / totalFrames) * 100}%` }}
          >
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-[10px] text-amber-400 whitespace-nowrap">
              OUT
            </div>
          </div>
        )}
      </div>

      {/* Controls Row */}
      <div className="flex items-center gap-1 sm:gap-2">
        {/* Frame Step Backward */}
        <button
          onClick={stepBackward}
          title="Previous Frame (←)"
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
        >
          <SkipBack className="h-4 w-4" />
        </button>

        {/* Play / Pause */}
        <button
          onClick={togglePlay}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500 text-white transition-all hover:bg-emerald-400 hover:shadow-lg hover:shadow-emerald-500/25 active:scale-95"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
        </button>

        {/* Frame Step Forward */}
        <button
          onClick={stepForward}
          title="Next Frame (→)"
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
        >
          <SkipForward className="h-4 w-4" />
        </button>

        {/* Divider */}
        <div className="mx-1 h-5 w-px bg-slate-800" />

        {/* Time & Frame Info */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <span className="text-slate-300">{formatTime(currentTime)}</span>
          <span className="text-slate-600">/</span>
          <span className="text-slate-500">{formatTime(duration)}</span>
        </div>

        {/* Frame Counter */}
        <div className="hidden sm:flex items-center gap-1 ml-1 rounded bg-slate-800 px-2 py-1 text-xs font-mono">
          <span className="text-emerald-400">{currentFrame}</span>
          <span className="text-slate-600">/</span>
          <span className="text-slate-500">{totalFrames}</span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Loop Controls */}
        <div className="hidden sm:flex items-center gap-1">
          {hasLoop ? (
            <button
              onClick={clearLoop}
              title="Clear Loop"
              className="flex h-7 items-center gap-1 rounded-md bg-amber-500/10 border border-amber-500/20 px-2 text-xs font-medium text-amber-400 transition-colors hover:bg-amber-500/20"
            >
              <RotateCcw className="h-3 w-3" />
              Clear Loop
            </button>
          ) : (
            <>
              <button
                onClick={() => setLoopStart(currentFrame)}
                title="Set Loop Start"
                className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
              >
                <span className="text-amber-400 text-[10px]">IN</span>
              </button>
              <button
                onClick={() => setLoopEnd(currentFrame)}
                title="Set Loop End"
                className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
              >
                <span className="text-amber-400 text-[10px]">OUT</span>
              </button>
            </>
          )}
        </div>

        {/* Divider */}
        <div className="hidden sm:block mx-1 h-5 w-px bg-slate-800" />

        {/* Speed Control */}
        <div className="flex items-center gap-1">
          <Gauge className="h-3.5 w-3.5 text-slate-500" />
          {PLAYBACK_SPEEDS.map((speed) => (
            <button
              key={speed}
              onClick={() => setPlaybackSpeed(speed)}
              className={`h-7 rounded-md px-2 text-xs font-medium transition-all ${
                playbackSpeed === speed
                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                  : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
              }`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
