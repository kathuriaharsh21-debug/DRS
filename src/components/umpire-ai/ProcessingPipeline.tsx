'use client'

import React, { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";

const PROCESSING_STEPS = [
  {
    id: "frame-extraction",
    label: "Frame Extraction",
    description: "Extracting key frames from video...",
  },
  {
    id: "ball-detection",
    label: "Ball Detection",
    description: "Running CV detection for ball tracking...",
  },
  {
    id: "trajectory-estimation",
    label: "Trajectory Estimation",
    description: "Computing ball trajectory with filtering...",
  },
  {
    id: "pitch-map",
    label: "Pitch Map Analysis",
    description: "Mapping ball path on pitch coordinates...",
  },
  {
    id: "decision-engine",
    label: "Decision Engine",
    description: "Running rule-based analysis with confidence scoring...",
  },
];

interface ProcessingPipelineProps {
  isComplete: boolean;
  progress?: number;        // 0-100 from backend
  message?: string;         // status message from backend
}

export default function ProcessingPipeline({ isComplete, progress = 0, message }: ProcessingPipelineProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [stepProgress, setStepProgress] = useState(0);
  const completeHandledRef = useRef(false);

  // Map real backend progress to step visualization
  useEffect(() => {
    if (isComplete) {
      completeHandledRef.current = true;
      setCurrentStep(PROCESSING_STEPS.length);
      setStepProgress(100);
      return;
    }

    completeHandledRef.current = false;

    // Derive current step and step-progress from overall backend progress
    const stepCount = PROCESSING_STEPS.length;
    const scaledProgress = (progress / 100) * stepCount;
    const activeStepIndex = Math.min(Math.floor(scaledProgress), stepCount - 1);
    const progressWithinStep = (scaledProgress - activeStepIndex) * 100;

    setCurrentStep(activeStepIndex);
    setStepProgress(Math.min(progressWithinStep, 100));

    // Update step descriptions based on backend message
    if (message) {
      if (message.includes("Frame") || message.includes("frame")) {
        // Already extracting/detecting
      }
    }
  }, [progress, message, isComplete]);

  const displayStep = isComplete ? PROCESSING_STEPS.length : currentStep;
  const displayProgress = isComplete ? 100 : stepProgress;

  const overallProgress = Math.min(
    100,
    ((displayStep + displayProgress / 100) / PROCESSING_STEPS.length) * 100
  );

  return (
    <div className="w-full max-w-2xl mx-auto animate-fade-in-up">
      {/* Overall progress */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-muted-foreground">Analyzing Video</span>
          <span className="text-sm font-mono text-emerald-400">
            {Math.round(Math.max(overallProgress, progress))}%
          </span>
        </div>
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${Math.max(overallProgress, progress)}%` }}
          />
        </div>
        {/* Backend status message */}
        {message && (
          <p className="text-xs text-muted-foreground/60 mt-1.5 font-mono truncate">
            {message}
          </p>
        )}
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {PROCESSING_STEPS.map((step, index) => {
          const isCompleted = index < displayStep;
          const isActive = index === displayStep && !isComplete;
          const isPending = index > displayStep;

          return (
            <div
              key={step.id}
              className={`
                flex items-start gap-3 p-3 rounded-lg border transition-all duration-500
                ${isCompleted ? "border-emerald-500/30 bg-emerald-500/5" : ""}
                ${isActive ? "border-amber-500/30 bg-amber-500/5" : ""}
                ${isPending ? "border-transparent opacity-40" : ""}
              `}
              style={{
                animationDelay: `${index * 100}ms`,
              }}
            >
              {/* Step icon */}
              <div
                className={`
                  w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all duration-300
                  ${isCompleted ? "bg-emerald-500/20 text-emerald-400" : ""}
                  ${isActive ? "bg-amber-500/20 text-amber-400" : ""}
                  ${isPending ? "bg-muted text-muted-foreground" : ""}
                `}
              >
                {isCompleted ? (
                  <Check className="w-4 h-4" />
                ) : isActive ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <span className="text-xs font-mono">{index + 1}</span>
                )}
              </div>

              {/* Step content */}
              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm font-medium transition-colors ${
                    isCompleted ? "text-emerald-400" : isActive ? "text-amber-400" : "text-muted-foreground"
                  }`}
                >
                  {step.label}
                </p>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {step.description}
                </p>

                {/* Active step progress bar */}
                {isActive && (
                  <div className="mt-2 h-0.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 rounded-full transition-all duration-300"
                      style={{
                        width: `${Math.min(displayProgress, 100)}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Completion indicator */}
      {isComplete && (
        <div className="mt-6 text-center animate-scale-in">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/30">
            <Check className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-medium text-emerald-400">
              Analysis Complete
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
