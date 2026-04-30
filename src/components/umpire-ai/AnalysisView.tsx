'use client'

import React, { useRef, useState, useCallback } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Video, Map, BarChart3, Box } from "lucide-react";
import type { AnalysisResult } from "@/lib/types";
import VideoPlayer, { VideoPlayerHandle } from "./VideoPlayer";
import DecisionPanel from "./DecisionPanel";
import PitchMap from "./PitchMap";
import StatsPanel from "./StatsPanel";
import PitchPathVideo from "./PitchPathVideo";

interface AnalysisViewProps {
  videoUrl: string;
  analysisResult: AnalysisResult;
  onReset: () => void;
}

export default function AnalysisView({
  videoUrl,
  analysisResult,
  onReset,
}: AnalysisViewProps) {
  const videoPlayerRef = useRef<VideoPlayerHandle>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [videoProgress, setVideoProgress] = useState(0);
  const [activeView, setActiveView] = useState<"split" | "video" | "3d">("split");

  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
  }, []);

  const handleTimeUpdate = useCallback((progress: number) => {
    setVideoProgress(progress);
  }, []);

  // Derive playing state from speed — the pitch video syncs with the video player
  // In split mode, the video player drives playback state
  const isVideoPlaying = videoPlayerRef.current?.getIsPlaying() ?? true;

  return (
    <div className="w-full max-w-7xl mx-auto animate-fade-in">
      {/* ==================== SIDE-BY-SIDE VIDEO SECTION ==================== */}
      <div className="space-y-4 mb-6">
        {/* View toggle tabs */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 bg-muted/50 border border-border/30 rounded-lg p-0.5">
            {[
              { key: "split" as const, label: "Side by Side", icon: Box },
              { key: "video" as const, label: "Original Video", icon: Video },
              { key: "3d" as const, label: "3D Pitch View", icon: Map },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveView(key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 ${
                  activeView === key
                    ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Speed badge */}
          {playbackSpeed !== 1 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/20">
              <span className="text-xs font-mono text-amber-400">
                Speed: {playbackSpeed}x
              </span>
            </div>
          )}
        </div>

        {/* Video display area */}
        <div
          className={`grid gap-4 ${
            activeView === "split"
              ? "grid-cols-1 lg:grid-cols-2"
              : "grid-cols-1"
          }`}
        >
          {/* Original video player */}
          {(activeView === "split" || activeView === "video") && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Video className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">
                  Original Video
                </span>
              </div>
              <VideoPlayer
                ref={videoPlayerRef}
                videoUrl={videoUrl}
                analysisResult={analysisResult}
                onPlaybackSpeedChange={handleSpeedChange}
                onTimeUpdate={handleTimeUpdate}
              />
            </div>
          )}

          {/* 3D Pitch Path Video */}
          {(activeView === "split" || activeView === "3d") && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Map className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">
                  3D Ball Path Tracking
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono">
                  AI PREDICTION
                </span>
              </div>
              <div className="relative rounded-xl overflow-hidden bg-black aspect-video border border-muted">
                <PitchPathVideo
                  analysisResult={analysisResult}
                  isPlaying={isVideoPlaying}
                  playbackSpeed={playbackSpeed}
                  videoProgress={videoProgress}
                />
                {/* Watermark */}
                <div className="absolute top-3 left-3 px-2 py-1 rounded bg-black/60 backdrop-blur-sm z-10 pointer-events-none">
                  <span className="text-xs font-mono font-bold text-cyan-400 tracking-wider">
                    3D TRACKING
                  </span>
                </div>
              </div>
              {/* Speed controls for 3D view when shown alone */}
              {activeView === "3d" && (
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="text-xs text-muted-foreground mr-1">Speed:</span>
                  {[0.25, 0.5, 1, 2].map((speed) => (
                    <button
                      key={speed}
                      onClick={() => handleSpeedChange(speed)}
                      className={`px-2 py-1 rounded text-xs font-mono transition-colors ${
                        playbackSpeed === speed
                          ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                      }`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ==================== BOTTOM SECTION: Decision + Details ==================== */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — Analysis tabs */}
        <div className="lg:col-span-2 space-y-4">
          <Tabs defaultValue="pitchmap" className="w-full">
            <TabsList className="w-full bg-muted/50 border border-border/30">
              <TabsTrigger
                value="pitchmap"
                className="flex-1 data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-400"
              >
                <Map className="w-4 h-4 mr-2" />
                Pitch Map
              </TabsTrigger>
              <TabsTrigger
                value="stats"
                className="flex-1 data-[state=active]:bg-emerald-500/10 data-[state=active]:text-emerald-400"
              >
                <BarChart3 className="w-4 h-4 mr-2" />
                Stats
              </TabsTrigger>
            </TabsList>
            <TabsContent value="pitchmap" className="mt-4">
              <Card className="border-border/50">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
                    <Video className="w-4 h-4" />
                    Top-Down Pitch View
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <PitchMap analysisResult={analysisResult} />
                  <p className="text-xs text-muted-foreground/60 mt-3 text-center">
                    Showing ball trajectory mapped onto pitch coordinates
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="stats" className="mt-4">
              <StatsPanel result={analysisResult} />
            </TabsContent>
          </Tabs>
        </div>

        {/* Right column — Decision Panel */}
        <div className="space-y-4">
          <DecisionPanel result={analysisResult} />
        </div>
      </div>

      {/* Analyze another button */}
      <div className="text-center mt-8">
        <button
          onClick={onReset}
          className="px-6 py-2.5 rounded-lg bg-muted/50 border border-border/30 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted hover:border-border transition-all duration-200"
        >
          Analyze Another Delivery
        </button>
      </div>
    </div>
  );
}
