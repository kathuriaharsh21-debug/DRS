'use client'

import React, { useRef, useEffect } from "react";
import type { AnalysisResult } from "@/lib/types";

interface PitchMapProps {
  analysisResult: AnalysisResult;
}

/** 2D top-down cricket pitch visualization */
export default function PitchMap({ analysisResult }: PitchMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear
    ctx.clearRect(0, 0, width, height);

    // Pitch dimensions (top-down view)
    const pitchLeft = 40;
    const pitchRight = width - 40;
    const pitchTop = 30;
    const pitchBottom = height - 30;
    const pitchWidth = pitchRight - pitchLeft;
    const pitchHeight = pitchBottom - pitchTop;

    // Draw pitch surface
    const pitchGrad = ctx.createLinearGradient(pitchLeft, pitchTop, pitchRight, pitchBottom);
    pitchGrad.addColorStop(0, "#1a4a2a");
    pitchGrad.addColorStop(0.5, "#1e5c35");
    pitchGrad.addColorStop(1, "#1a4a2a");
    ctx.fillStyle = pitchGrad;
    ctx.fillRect(pitchLeft, pitchTop, pitchWidth, pitchHeight);

    // Pitch boundary
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 2;
    ctx.strokeRect(pitchLeft, pitchTop, pitchWidth, pitchHeight);

    // Crease lines (bowling end - top)
    const creaseY1 = pitchTop + 30;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pitchLeft - 20, creaseY1);
    ctx.lineTo(pitchRight + 20, creaseY1);
    ctx.stroke();

    // Return crease (bowling end)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pitchLeft - 20, creaseY1 - 40);
    ctx.lineTo(pitchRight + 20, creaseY1 - 40);
    ctx.stroke();

    // Crease lines (batting end - bottom)
    const creaseY2 = pitchBottom - 30;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pitchLeft - 20, creaseY2);
    ctx.lineTo(pitchRight + 20, creaseY2);
    ctx.stroke();

    // Return crease (batting end)
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pitchLeft - 20, creaseY2 + 40);
    ctx.lineTo(pitchRight + 20, creaseY2 + 40);
    ctx.stroke();

    // Stumps (bowling end)
    const stumpCenterX = width / 2;
    const stumpGap = 6;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(stumpCenterX + i * stumpGap, creaseY1 - 3);
      ctx.lineTo(stumpCenterX + i * stumpGap, creaseY1 + 3);
      ctx.stroke();
    }

    // Stumps (batting end)
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(stumpCenterX + i * stumpGap, creaseY2 - 3);
      ctx.lineTo(stumpCenterX + i * stumpGap, creaseY2 + 3);
      ctx.stroke();
    }

    // Center strip (darker grass line)
    ctx.fillStyle = "rgba(0, 0, 0, 0.1)";
    ctx.fillRect(stumpCenterX - 3, pitchTop, 6, pitchHeight);

    // Labels
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("BOWLING END", stumpCenterX, pitchTop - 8);
    ctx.fillText("BATSMAN END", stumpCenterX, pitchBottom + 16);

    // ========== Draw trajectory data ==========

    const { trajectory, frameData, decision } = analysisResult;

    // Ball pitch point
    const pitchPointX = pitchLeft + trajectory.pitchPoint.x * pitchWidth;
    const pitchPointY = pitchTop + trajectory.pitchPoint.y * pitchHeight;

    // Draw ball trajectory path on pitch
    if (frameData.length > 0) {
      const isHitting = decision === "OUT";

      // Convert frame data to pitch coordinates
      const mappedPoints = frameData.map((p) => ({
        x: pitchLeft + p.x * pitchWidth,
        y: pitchTop + p.y * pitchHeight,
      }));

      // Draw the path
      ctx.strokeStyle = "rgba(245, 158, 11, 0.6)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(mappedPoints[0].x, mappedPoints[0].y);
      for (let i = 1; i < mappedPoints.length; i++) {
        ctx.lineTo(mappedPoints[i].x, mappedPoints[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Glow on path
      ctx.strokeStyle = "rgba(245, 158, 11, 0.15)";
      ctx.lineWidth = 8;
      ctx.filter = "blur(3px)";
      ctx.beginPath();
      ctx.moveTo(mappedPoints[0].x, mappedPoints[0].y);
      for (let i = 1; i < mappedPoints.length; i++) {
        ctx.lineTo(mappedPoints[i].x, mappedPoints[i].y);
      }
      ctx.stroke();
      ctx.filter = "none";

      // Predicted path to stumps (dashed line from last point)
      const lastPoint = mappedPoints[mappedPoints.length - 1];
      ctx.strokeStyle = isHitting ? "rgba(239, 68, 68, 0.5)" : "rgba(59, 130, 246, 0.5)";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      ctx.moveTo(lastPoint.x, lastPoint.y);
      ctx.lineTo(stumpCenterX, creaseY2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Pitch point marker (large dot)
    const pitchGlow = ctx.createRadialGradient(
      pitchPointX, pitchPointY, 0,
      pitchPointX, pitchPointY, 15
    );
    pitchGlow.addColorStop(0, "rgba(16, 185, 129, 0.4)");
    pitchGlow.addColorStop(1, "transparent");
    ctx.fillStyle = pitchGlow;
    ctx.beginPath();
    ctx.arc(pitchPointX, pitchPointY, 15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#10b981";
    ctx.beginPath();
    ctx.arc(pitchPointX, pitchPointY, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#10b981";
    ctx.font = "bold 9px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText("PITCH", pitchPointX + 8, pitchPointY + 3);

    // Batsman position (circle near batting crease)
    const batsmanX = stumpCenterX + 15;
    const batsmanY = creaseY2 + 10;

    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.beginPath();
    ctx.arc(batsmanX, batsmanY, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.font = "bold 8px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("BAT", batsmanX, batsmanY + 3);

    // Deviation indicator
    if (Math.abs(trajectory.deviation) > 0.5) {
      const devX = pitchPointX + 30;
      const devY = pitchPointY - 15;
      ctx.fillStyle = "rgba(245, 158, 11, 0.8)";
      ctx.font = "8px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(
        `${trajectory.deviation > 0 ? "↗" : "↙"} ${Math.abs(trajectory.deviation)}°`,
        devX,
        devY
      );
    }

    // Hitting zone highlight
    if (decision === "OUT") {
      ctx.fillStyle = "rgba(239, 68, 68, 0.06)";
      ctx.fillRect(
        stumpCenterX - 15,
        creaseY2 - 8,
        30,
        16
      );
      ctx.strokeStyle = "rgba(239, 68, 68, 0.3)";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        stumpCenterX - 15,
        creaseY2 - 8,
        30,
        16
      );
    }
  }, [analysisResult]);

  return (
    <div className="w-full">
      <canvas
        ref={canvasRef}
        width={400}
        height={280}
        className="w-full h-auto rounded-lg"
      />
    </div>
  );
}
