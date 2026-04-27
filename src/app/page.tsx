'use client'

import React, { useState, useCallback } from "react";
import { CircleDot, Zap, ArrowRight, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import VideoUploader from "@/components/umpire-ai/VideoUploader";
import ProcessingPipeline from "@/components/umpire-ai/ProcessingPipeline";
import AnalysisView from "@/components/umpire-ai/AnalysisView";
import type { AnalysisResult, ScreenState } from "@/lib/types";

export default function Home() {
  const [screen, setScreen] = useState<ScreenState>("upload");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileSelect = useCallback((file: File, url: string) => {
    setVideoUrl(url);
    startProcessing(file);
  }, []);

  const startProcessing = useCallback(async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setScreen("processing");

    try {
      const formData = new FormData();
      formData.append("video", file);

      const response = await fetch("/api/process-video", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Processing failed");
      }

      const data = await response.json();
      setAnalysisResult(data.data);

      // Wait a moment after processing finishes before showing results
      setTimeout(() => {
        setScreen("analysis");
        setIsProcessing(false);
      }, 1000);
    } catch (err) {
      console.error("Processing error:", err);
      setError(err instanceof Error ? err.message : "Failed to process video");
      setIsProcessing(false);
      setScreen("upload");
    }
  }, []);

  const handleReset = useCallback(() => {
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }
    setVideoUrl("");
    setAnalysisResult(null);
    setIsProcessing(false);
    setError(null);
    setScreen("upload");
  }, [videoUrl]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative w-9 h-9 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-pulse-glow-green" />
              <CircleDot className="w-6 h-6 text-emerald-400 relative z-10" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">
                <span className="text-emerald-400">Umpire</span>{" "}
                <span className="text-foreground">AI</span>
              </h1>
              <p className="text-[10px] text-muted-foreground/60 font-mono tracking-widest uppercase -mt-0.5">
                Ball Trajectory Analysis
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {screen === "analysis" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="w-4 h-4 mr-1.5" />
                New Analysis
              </Button>
            )}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20">
              <Zap className="w-3 h-3 text-emerald-400" />
              <span className="text-xs font-mono text-emerald-400">v2.1</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-8">
        {/* ===== UPLOAD SCREEN ===== */}
        {screen === "upload" && (
          <div className="w-full flex flex-col items-center gap-8">
            {/* Hero section */}
            <div className="text-center max-w-lg animate-fade-in-up">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 mb-4">
                <Zap className="w-3 h-3 text-amber-400" />
                <span className="text-xs font-medium text-amber-400">
                  AI-Powered Cricket Analysis
                </span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight mb-3">
                Analyze Ball Trajectory
              </h2>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Upload a cricket match video from the umpire&apos;s camera view to analyze
                ball trajectory, detect LBW, No-ball, Wide, and more with Hawk-Eye precision.
              </p>
            </div>

            {/* Feature cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl animate-fade-in-up" style={{ animationDelay: "100ms" }}>
              {[
                { label: "Ball Detection", desc: "YOLO v8 tracking", icon: "🎯" },
                { label: "3D Trajectory", desc: "Stereo estimation", icon: "📐" },
                { label: "Decision Engine", desc: "Rule-based AI", icon: "⚖️" },
              ].map((feature) => (
                <Card key={feature.label} className="bg-muted/30 border-border/30 py-4">
                  <CardContent className="flex flex-col items-center text-center gap-1.5 px-4">
                    <span className="text-xl">{feature.icon}</span>
                    <span className="text-xs font-semibold">{feature.label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {feature.desc}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Uploader */}
            <VideoUploader onFileSelect={handleFileSelect} />

            {error && (
              <div className="max-w-md animate-fade-in">
                <Card className="border-red-500/30 bg-red-500/5">
                  <CardContent className="py-3 px-4">
                    <p className="text-sm text-red-400">{error}</p>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* Footer note */}
            <p className="text-xs text-muted-foreground/40 text-center max-w-md">
              Supports MP4, WebM, MOV, AVI formats up to 500MB.
              Video is processed locally and not stored on any server.
            </p>
          </div>
        )}

        {/* ===== PROCESSING SCREEN ===== */}
        {screen === "processing" && (
          <div className="w-full flex flex-col items-center gap-8">
            <div className="text-center animate-fade-in-up">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 mb-4">
                <Loader2 className="w-7 h-7 text-amber-400 animate-spin" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight mb-2">
                Processing Video
              </h2>
              <p className="text-sm text-muted-foreground">
                Running AI analysis pipeline on your video...
              </p>
            </div>

            <ProcessingPipeline isComplete={!isProcessing && screen === "processing"} />

            {error && (
              <div className="max-w-md animate-fade-in">
                <Card className="border-red-500/30 bg-red-500/5">
                  <CardContent className="py-3 px-4 flex items-center justify-between">
                    <p className="text-sm text-red-400">{error}</p>
                    <Button variant="ghost" size="sm" onClick={handleReset}>
                      Try Again
                    </Button>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        )}

        {/* ===== ANALYSIS SCREEN ===== */}
        {screen === "analysis" && analysisResult && (
          <AnalysisView
            videoUrl={videoUrl}
            analysisResult={analysisResult}
            onReset={handleReset}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/30 py-4 mt-auto">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground/40">
            Umpire AI — Ball Trajectory Analysis Prototype
          </p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground/40">
            <span>Powered by AI</span>
            <span>•</span>
            <span>Hawk-Eye Style Visualization</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
