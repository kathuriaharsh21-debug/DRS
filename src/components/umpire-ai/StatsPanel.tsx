'use client'

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Gauge,
  MoveHorizontal,
  ArrowDownUp,
  Target,
  Zap,
  Activity,
} from "lucide-react";
import type { AnalysisResult } from "@/lib/types";

interface StatsPanelProps {
  result: AnalysisResult;
}

export default function StatsPanel({ result }: StatsPanelProps) {
  const { trajectory, decision } = result;
  const isHitting = decision === "OUT";

  const stats = [
    {
      label: "Ball Speed",
      value: `${trajectory.ballSpeed}`,
      unit: "km/h",
      icon: Gauge,
      color: "text-amber-400",
      bgColor: "bg-amber-500/10",
    },
    {
      label: "Deviation",
      value: `${trajectory.deviation > 0 ? "+" : ""}${trajectory.deviation}`,
      unit: "degrees",
      icon: MoveHorizontal,
      color: "text-emerald-400",
      bgColor: "bg-emerald-500/10",
    },
    {
      label: "Impact Height",
      value: trajectory.impactHeight,
      unit: "",
      icon: ArrowDownUp,
      color: "text-amber-400",
      bgColor: "bg-amber-500/10",
    },
    {
      label: "Predicted Path",
      value: trajectory.predictedPath,
      unit: "",
      icon: Target,
      color: isHitting ? "text-red-400" : "text-blue-400",
      bgColor: isHitting ? "bg-red-500/10" : "bg-blue-500/10",
      isBadge: true,
    },
  ];

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-muted-foreground">
          <Activity className="w-4 h-4" />
          Trajectory Data
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border/30"
              >
                <div
                  className={`w-8 h-8 rounded-lg ${stat.bgColor} flex items-center justify-center shrink-0`}
                >
                  <Icon className={`w-4 h-4 ${stat.color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    {stat.isBadge ? (
                      <Badge
                        variant="outline"
                        className={`text-xs font-bold border ${
                          stat.color
                        } ${stat.bgColor}`}
                      >
                        <Zap className="w-3 h-3 mr-1" />
                        {stat.value}
                      </Badge>
                    ) : (
                      <>
                        <span className="text-lg font-bold text-foreground">
                          {stat.value}
                        </span>
                        {stat.unit && (
                          <span className="text-xs text-muted-foreground">
                            {stat.unit}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pitch point coordinates */}
        <div className="mt-3 p-3 rounded-lg bg-muted/30 border border-border/20">
          <p className="text-xs text-muted-foreground mb-1">Pitch Point Coordinates</p>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono text-muted-foreground/60">X:</span>
              <span className="text-sm font-mono font-bold text-emerald-400">
                {(trajectory.pitchPoint.x * 100).toFixed(1)}cm
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono text-muted-foreground/60">Y:</span>
              <span className="text-sm font-mono font-bold text-emerald-400">
                {(trajectory.pitchPoint.y * 100).toFixed(1)}cm
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
