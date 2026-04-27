'use client'

import React, { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, ShieldAlert } from "lucide-react";
import type { AnalysisResult, DecisionType } from "@/lib/types";

interface DecisionPanelProps {
  result: AnalysisResult;
}

const DECISION_TYPE_LABELS: Record<DecisionType, string> = {
  LBW: "Leg Before Wicket",
  NO_BALL: "No Ball",
  WIDE: "Wide Ball",
  CAUGHT_BEHIND: "Caught Behind",
  BOWLED: "Bowled",
  NOT_OUT: "Not Out",
};

const DECISION_TYPE_DESCRIPTIONS: Record<DecisionType, string> = {
  LBW: "Ball would have hit the stumps, struck the batsman's pad in line with the wicket.",
  NO_BALL: "Bowler's front foot crossed the popping crease during delivery.",
  WIDE: "Ball passed too wide of the batsman to be reasonably played.",
  CAUGHT_BEHIND: "Ball struck the bat and was caught by the wicketkeeper or slips.",
  BOWLED: "Ball directly struck and dislodged the bails at the striker's end.",
  NOT_OUT: "Insufficient evidence to overturn the on-field decision.",
};

export default function DecisionPanel({ result }: DecisionPanelProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsVisible(true), 200);
    const detailsTimer = setTimeout(() => setShowDetails(true), 800);
    return () => {
      clearTimeout(timer);
      clearTimeout(detailsTimer);
    };
  }, []);

  const isOut = result.decision === "OUT";

  return (
    <Card
      className={`
        relative overflow-hidden transition-all duration-700
        ${isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}
        ${isOut
          ? "border-red-500/30 animate-pulse-glow-red"
          : "border-emerald-500/30 animate-pulse-glow-green"
        }
      `}
    >
      {/* Background glow */}
      <div
        className={`absolute inset-0 opacity-5 transition-opacity duration-700 ${
          isOut ? "bg-gradient-to-br from-red-500/20 to-red-900/20" : "bg-gradient-to-br from-emerald-500/20 to-emerald-900/20"
        }`}
      />

      <CardContent className="relative p-6 text-center">
        {/* Main decision display */}
        <div
          className={`transition-all duration-700 ${isVisible ? "scale-100 opacity-100" : "scale-75 opacity-0"}`}
        >
          <div className="flex items-center justify-center mb-3">
            {isOut ? (
              <ShieldAlert
                className="w-12 h-12 text-red-400 animate-float"
              />
            ) : (
              <Shield className="w-12 h-12 text-emerald-400 animate-float" />
            )}
          </div>

          {/* Large decision text */}
          <h2
            className={`
              text-6xl md:text-7xl font-black tracking-tight animate-text-glow
              ${isOut ? "text-red-400" : "text-emerald-400"}
            `}
          >
            {result.decision}
          </h2>

          {/* Decision type badge */}
          <div className="mt-4">
            <Badge
              variant="outline"
              className={`
                px-4 py-1.5 text-sm font-bold tracking-wide border
                ${isOut
                  ? "border-red-500/50 text-red-400 bg-red-500/10"
                  : "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                }
              `}
            >
              {result.decisionType.replace("_", " ")}
            </Badge>
          </div>

          {/* Decision type label */}
          <p className="text-sm text-muted-foreground mt-2 font-medium">
            {DECISION_TYPE_LABELS[result.decisionType]}
          </p>
        </div>

        {/* Details (fade in after main display) */}
        <div
          className={`mt-6 pt-6 border-t border-border/50 transition-all duration-700 ${
            showDetails ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
          }`}
        >
          {/* Confidence ring */}
          <div className="flex items-center justify-center mb-4">
            <div className="relative w-20 h-20">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                <circle
                  cx="40" cy="40" r="34"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="4"
                  className="text-muted/30"
                />
                <circle
                  cx="40" cy="40" r="34"
                  fill="none"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={`${(result.confidence / 100) * 213.6} 213.6`}
                  className={`transition-all duration-1000 ${isOut ? "text-red-400" : "text-emerald-400"}`}
                  style={{ stroke: "currentColor" }}
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold text-foreground">
                  {result.confidence}%
                </span>
              </div>
            </div>
            <div className="ml-4 text-left">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">Confidence</p>
              <p className="text-sm font-semibold text-foreground">AI Analysis</p>
            </div>
          </div>

          {/* Description */}
          <p className="text-xs text-muted-foreground/80 leading-relaxed max-w-sm mx-auto">
            {DECISION_TYPE_DESCRIPTIONS[result.decisionType]}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
