'use client'

import React, { useRef, useState, useEffect } from "react";
import { Play, Pause, RotateCcw, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnalysisResult } from "@/lib/types";
import TrajectoryCanvas from "./TrajectoryCanvas";

interface VideoPlayerProps {
  videoUrl: string;
  analysisResult: AnalysisResult;
}

export default function VideoPlayer({ videoUrl, analysisResult }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showTrajectory, setShowTrajectory] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

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
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 mt-2">
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
