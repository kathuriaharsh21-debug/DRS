'use client'

import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { Play, Pause, RotateCcw, Maximize2, Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnalysisResult } from "@/lib/types";
import TrajectoryCanvas from "./TrajectoryCanvas";

export interface VideoPlayerHandle {
  getIsPlaying: () => boolean;
  getPlaybackSpeed: () => number;
}

interface VideoPlayerProps {
  videoUrl: string;
  analysisResult: AnalysisResult;
  onPlaybackSpeedChange?: (speed: number) => void;
}

const SPEED_OPTIONS = [
  { label: "0.25x", value: 0.25 },
  { label: "0.5x", value: 0.5 },
  { label: "1x", value: 1 },
  { label: "2x", value: 2 },
];

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer({ videoUrl, analysisResult, onPlaybackSpeedChange }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [showTrajectory, setShowTrajectory] = useState(false);
    const [hasStarted, setHasStarted] = useState(false);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [showSpeedMenu, setShowSpeedMenu] = useState(false);

    useImperativeHandle(ref, () => ({
      getIsPlaying: () => isPlaying,
      getPlaybackSpeed: () => playbackSpeed,
    }));

    // Sync playback speed to video element
    useEffect(() => {
      if (videoRef.current) {
        videoRef.current.playbackRate = playbackSpeed;
      }
    }, [playbackSpeed]);

    // Auto-play video when analysis view is shown
    useEffect(() => {
      const timer = setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.play().catch(() => {});
          setIsPlaying(true);
          setShowTrajectory(true);
          setHasStarted(true);
        }
      }, 800);
      return () => clearTimeout(timer);
    }, []);

    const togglePlay = () => {
      if (!videoRef.current) return;
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
        if (!hasStarted) {
          setShowTrajectory(true);
          setHasStarted(true);
        }
      }
      setIsPlaying(!isPlaying);
    };

    const restart = () => {
      if (!videoRef.current) return;
      videoRef.current.currentTime = 0;
      videoRef.current.play();
      setIsPlaying(true);
      setShowTrajectory(true);
      setHasStarted(true);
    };

    const handleSpeedChange = (speed: number) => {
      setPlaybackSpeed(speed);
      setShowSpeedMenu(false);
      onPlaybackSpeedChange?.(speed);
    };

    const toggleFullscreen = () => {
      if (!containerRef.current) return;
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        containerRef.current.requestFullscreen();
      }
    };

    return (
      <div className="relative w-full">
        <div
          ref={containerRef}
          className="relative rounded-xl overflow-hidden bg-black aspect-video border border-muted"
        >
          {/* Video element */}
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full object-contain"
            loop
            muted
            playsInline
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
          />

          {/* Trajectory canvas overlay */}
          {showTrajectory && (
            <TrajectoryCanvas
              frameData={analysisResult.frameData}
              isAnimating={hasStarted}
              decision={analysisResult.decision}
            />
          )}

          {/* Play/Pause overlay when not playing */}
          {!isPlaying && !hasStarted && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer" onClick={togglePlay}>
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center backdrop-blur-sm">
                <Play className="w-8 h-8 text-emerald-400 ml-1" />
              </div>
            </div>
          )}

          {/* UMPIRE AI watermark */}
          <div className="absolute top-3 left-3 px-2 py-1 rounded bg-black/60 backdrop-blur-sm">
            <span className="text-xs font-mono font-bold text-emerald-400 tracking-wider">
              UMPIRE AI
            </span>
          </div>

          {/* Decision badge */}
          {hasStarted && (
            <div
              className={`absolute top-3 right-3 px-3 py-1 rounded backdrop-blur-sm font-bold text-sm tracking-wider animate-scale-in ${
                analysisResult.decision === "OUT"
                  ? "bg-red-500/20 text-red-400 border border-red-500/40"
                  : "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
              }`}
            >
              {analysisResult.decision}
            </div>
          )}

          {/* Speed indicator badge */}
          {hasStarted && playbackSpeed !== 1 && (
            <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-black/60 backdrop-blur-sm">
              <span className="text-xs font-mono font-bold text-amber-400 tracking-wider">
                {playbackSpeed}x
              </span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1.5 mt-2">
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground h-8 w-8"
            onClick={togglePlay}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground h-8 w-8"
            onClick={restart}
          >
            <RotateCcw className="w-4 h-4" />
          </Button>

          {/* Speed control */}
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 px-2 text-xs font-mono gap-1.5 ${
                playbackSpeed !== 1
                  ? "text-amber-400 hover:text-amber-300"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setShowSpeedMenu(!showSpeedMenu)}
            >
              <Gauge className="w-3.5 h-3.5" />
              {playbackSpeed}x
            </Button>

            {showSpeedMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowSpeedMenu(false)} />
                <div className="absolute bottom-full left-0 mb-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 min-w-[80px]">
                  {SPEED_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleSpeedChange(opt.value)}
                      className={`w-full px-3 py-1.5 text-xs font-mono text-left hover:bg-muted transition-colors ${
                        playbackSpeed === opt.value
                          ? "text-amber-400 bg-muted"
                          : "text-muted-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground h-8 w-8"
            onClick={toggleFullscreen}
          >
            <Maximize2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    );
  }
);

export default VideoPlayer;
