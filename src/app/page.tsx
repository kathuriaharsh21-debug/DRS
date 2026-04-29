'use client'

import React, { useState, useCallback, useRef } from "react";
import { CircleDot, Zap, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import VideoUploader from "@/components/umpire-ai/VideoUploader";
import ProcessingPipeline from "@/components/umpire-ai/ProcessingPipeline";
import AnalysisView from "@/components/umpire-ai/AnalysisView";
import type { AnalysisResult, ScreenState } from "@/lib/types";

/** Map backend dismissal_type to frontend DecisionType */
function mapDecisionType(dt: string): AnalysisResult["decisionType"] {
  const map: Record<string, AnalysisResult["decisionType"]> = {
    LBW: "LBW",
    BOWLED: "BOWLED",
    CAUGHT_BEHIND: "CAUGHT_BEHIND",
    NO_BALL: "NO_BALL",
    WIDE: "WIDE",
    NOT_OUT: "NOT_OUT",
  };
  return map[dt] || "NOT_OUT";
}

/** Transform backend analysis result into frontend AnalysisResult */
function transformResult(data: any): AnalysisResult {
  const isHitting = data.predicted_stump_hit === true;
  return {
    decision: (data.decision?.decision || "NOT OUT") as "OUT" | "NOT OUT",
    decisionType: mapDecisionType(data.decision?.dismissal_type || "NOT_OUT"),
    confidence: Math.round((data.confidence || 0.8) * 100),
    trajectory: {
      pitchPoint: {
        x: data.decision?.pitch_point?.x ?? 0.5,
        y: data.decision?.pitch_point?.y ?? 0.5,
      },
      deviation: data.deviation_degrees ?? 0,
      impactHeight: data.decision?.impact_point
        ? data.decision.impact_point.y < 0.4
          ? "Low"
          : data.decision.impact_point.y < 0.6
            ? "Middle"
            : "High"
        : "Middle",
      predictedPath: isHitting ? "HITTING" : "MISSING",
      ballSpeed: Math.round(data.ball_speed_kmh || 0),
    },
    frameData: (data.trajectory || []).map((pt: any, idx: number) => ({
      x: pt.x ?? 0.5,
      y: pt.y ?? 0.5,
      frame: pt.frame_number ?? idx,
    })),
  };
}

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "https://umpire-ai-backend.onrender.com";

export default function Home() {
  const [screen, setScreen] = useState<ScreenState>("upload");
  const [videoUrl, setVideoUrl] = useState<string>("");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingMessage, setProcessingMessage] = useState<string>("");
  const [processingProgress, setProcessingProgress] = useState<number>(0);
  const abortRef = useRef<AbortController | null>(null);

  const startProcessing = useCallback(async (file: File) => {
    setIsProcessing(true);
    setError(null);
    setScreen("processing");
    setProcessingMessage("Uploading video to analysis backend...");
    setProcessingProgress(0);

    const abortController = new AbortController();
    abortRef.current = abortController;

    try {
      // Step 1: Upload video DIRECTLY to Render backend (bypasses Vercel 4.5MB body limit)
      const formData = new FormData();
      formData.append("file", file);
      formData.append("ball_type", "red");

      const uploadRes = await fetch(`${BACKEND_URL}/api/upload-and-analyze`, {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });

      if (!uploadRes.ok) {
        let detail = "";
        try {
          const errBody = await uploadRes.json();
          detail = Array.isArray(errBody.detail)
            ? errBody.detail.map((d: any) => d.msg).join(", ")
            : errBody.detail || uploadRes.statusText;
        } catch {
          detail = `HTTP ${uploadRes.status}`;
        }
        throw new Error(`Upload & analyze failed: ${detail}`);
      }

      const uploadData = await uploadRes.json();
      const jobId = uploadData.job_id;

      if (!jobId) {
        throw new Error("No job ID received from server");
      }

      setProcessingMessage("Analysis started, processing frames...");

      // Step 2: Poll for analysis status via Vercel proxy (lightweight JSON payloads)
      const POLL_INTERVAL = 3000;
      const MAX_WAIT = 600000; // 10 minutes max
      const startTime = Date.now();

      while (Date.now() - startTime < MAX_WAIT) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));

        if (abortController.signal.aborted) break;

        const statusRes = await fetch(
          `/api/process-video?jobId=${jobId}`,
          { signal: abortController.signal }
        );

        if (!statusRes.ok) {
          // Server might be slow, wait and retry
          continue;
        }

        const status = await statusRes.json();

        setProcessingProgress(Math.round((status.progress || 0) * 100));
        setProcessingMessage(status.message || "Processing...");

        if (status.status === "completed") {
          // Step 3: Fetch result via proxy
          const resultRes = await fetch(
            `/api/process-video?jobId=${jobId}&mode=result`,
            { signal: abortController.signal }
          );

          if (!resultRes.ok) {
            throw new Error("Failed to fetch analysis result");
          }

          const resultData = await resultRes.json();
          const transformed = transformResult(resultData);
          setAnalysisResult(transformed);

          setTimeout(() => {
            setScreen("analysis");
            setIsProcessing(false);
          }, 1000);
          return;
        }

        if (status.status === "failed" || status.error) {
          throw new Error(
            status.error || "Analysis failed on server. Please try again."
          );
        }
      }

      throw new Error("Analysis timed out. The server may be slow — please try again.");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      console.error("Processing error:", err);
      setError((err as Error).message || "Failed to process video");
      setIsProcessing(false);
      setScreen("upload");
    }
  }, []);

  const handleFileSelect = useCallback(
    (file: File, url: string) => {
      setVideoUrl(url);
      startProcessing(file);
    },
    [startProcessing]
  );

  const handleReset = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl("");
    setAnalysisResult(null);
    setIsProcessing(false);
    setError(null);
    setProcessingMessage("");
    setProcessingProgress(0);
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
            {isProcessing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="text-muted-foreground hover:text-destructive"
              >
                <RotateCcw className="w-4 h-4 mr-1.5" />
                Cancel
              </Button>
            )}
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
                { label: "Ball Detection", desc: "Classical CV tracking", icon: "🎯" },
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
              Video is processed on the cloud backend and results are returned instantly.
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

            <ProcessingPipeline
              isComplete={false}
              progress={processingProgress}
              message={processingMessage}
            />

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
            Umpire AI — Ball Trajectory Analysis System
          </p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground/40">
            <span>Powered by OpenCV + AI</span>
            <span>•</span>
            <span>Hawk-Eye Style Visualization</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
