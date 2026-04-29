'use client'

import React, { useRef, useEffect } from "react";
import type { AnalysisResult } from "@/lib/types";

interface PitchMapProps {
  analysisResult: AnalysisResult;
}

/** 2D top-down cricket pitch with Hawk-Eye style trajectory + prediction overlay */
export default function PitchMap({ analysisResult }: PitchMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // ==========================================
    // Pitch geometry
    // ==========================================
    const margin = 30;
    const pitchLeft = margin + 20;
    const pitchRight = W - margin - 20;
    const pitchTop = margin + 5;
    const pitchBottom = H - margin - 5;
    const pitchW = pitchRight - pitchLeft;
    const pitchH = pitchBottom - pitchTop;
    const centerX = (pitchLeft + pitchRight) / 2;

    // ==========================================
    // Draw pitch surface with subtle 3D perspective gradient
    // ==========================================
    const surfGrad = ctx.createLinearGradient(pitchLeft, pitchTop, pitchLeft, pitchBottom);
    surfGrad.addColorStop(0, "#14532d");
    surfGrad.addColorStop(0.3, "#166534");
    surfGrad.addColorStop(0.5, "#15803d");
    surfGrad.addColorStop(0.7, "#166534");
    surfGrad.addColorStop(1, "#14532d");
    ctx.fillStyle = surfGrad;
    ctx.fillRect(pitchLeft, pitchTop, pitchW, pitchH);

    // Subtle striping (mowed grass effect)
    ctx.fillStyle = "rgba(0, 0, 0, 0.04)";
    const stripH = pitchH / 16;
    for (let i = 0; i < 16; i += 2) {
      ctx.fillRect(pitchLeft, pitchTop + i * stripH, pitchW, stripH);
    }

    // Pitch boundary
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(pitchLeft, pitchTop, pitchW, pitchH);

    // ==========================================
    // Crease lines
    // ==========================================
    const bowlingCreaseY = pitchTop + 40;
    const battingCreaseY = pitchBottom - 40;
    const returnCreaseOffset = 50;

    // Bowling crease
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pitchLeft - 15, bowlingCreaseY);
    ctx.lineTo(pitchRight + 15, bowlingCreaseY);
    ctx.stroke();

    // Bowling return crease
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pitchLeft - 15, bowlingCreaseY - returnCreaseOffset);
    ctx.lineTo(pitchRight + 15, bowlingCreaseY - returnCreaseOffset);
    ctx.stroke();

    // Batting crease
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pitchLeft - 15, battingCreaseY);
    ctx.lineTo(pitchRight + 15, battingCreaseY);
    ctx.stroke();

    // Batting return crease
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pitchLeft - 15, battingCreaseY + returnCreaseOffset);
    ctx.lineTo(pitchRight + 15, battingCreaseY + returnCreaseOffset);
    ctx.stroke();

    // ==========================================
    // Stumps (bowling end — small, perspective effect)
    // ==========================================
    const bowlingStumpW = 8;
    const bowlingStumpGap = 4;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(centerX + i * bowlingStumpGap, bowlingCreaseY - 2);
      ctx.lineTo(centerX + i * bowlingStumpGap, bowlingCreaseY + bowlingStumpW);
      ctx.stroke();
    }
    // Bails bowling end
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(centerX - bowlingStumpGap, bowlingCreaseY - 2);
    ctx.lineTo(centerX + bowlingStumpGap, bowlingCreaseY - 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX - bowlingStumpGap, bowlingCreaseY + bowlingStumpW);
    ctx.lineTo(centerX + bowlingStumpGap, bowlingCreaseY + bowlingStumpW);
    ctx.stroke();

    // ==========================================
    // Stumps (batting end — larger, closer to viewer)
    // ==========================================
    const batStumpW = 16;
    const batStumpGap = 8;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = 2.5;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(centerX + i * batStumpGap, battingCreaseY - 4);
      ctx.lineTo(centerX + i * batStumpGap, battingCreaseY + batStumpW);
      ctx.stroke();
    }
    // Bails batting end
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.beginPath();
    ctx.moveTo(centerX - batStumpGap, battingCreaseY - 4);
    ctx.lineTo(centerX + batStumpGap, battingCreaseY - 4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(centerX - batStumpGap, battingCreaseY + batStumpW);
    ctx.lineTo(centerX + batStumpGap, battingCreaseY + batStumpW);
    ctx.stroke();

    // ==========================================
    // Labels
    // ==========================================
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.font = "8px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("BOWLING END", centerX, pitchTop - 4);
    ctx.fillText("BATSMAN END", centerX, pitchBottom + 14);

    // ==========================================
    // Draw trajectory and prediction
    // ==========================================
    const { trajectory, frameData, decision } = analysisResult;
    const isHitting = decision === "OUT";

    if (frameData.length > 1) {
      // -- Actual tracked path (post-release, amber/orange) --
      const mappedPoints = frameData.map((p) => ({
        x: pitchLeft + p.x * pitchW,
        y: pitchTop + p.y * pitchH,
      }));

      // Glow
      ctx.save();
      ctx.strokeStyle = "rgba(251, 191, 36, 0.12)";
      ctx.lineWidth = 10;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(mappedPoints[0].x, mappedPoints[0].y);
      for (let i = 1; i < mappedPoints.length; i++) {
        ctx.lineTo(mappedPoints[i].x, mappedPoints[i].y);
      }
      ctx.stroke();
      ctx.restore();

      // Main line
      ctx.strokeStyle = "rgba(251, 191, 36, 0.85)";
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(mappedPoints[0].x, mappedPoints[0].y);
      for (let i = 1; i < mappedPoints.length; i++) {
        ctx.lineTo(mappedPoints[i].x, mappedPoints[i].y);
      }
      ctx.stroke();

      // Dots along path
      for (let i = 0; i < mappedPoints.length; i++) {
        const pt = mappedPoints[i];
        const t = i / (mappedPoints.length - 1);
        let dotColor = "#f59e0b";
        if (t > 0.7) dotColor = isHitting ? "#ef4444" : "#3b82f6";

        ctx.fillStyle = dotColor;
        ctx.globalAlpha = 0.6;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Ball release point marker
      const releasePt = mappedPoints[0];
      ctx.fillStyle = "#22d3ee";
      ctx.font = "bold 8px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.beginPath();
      ctx.arc(releasePt.x, releasePt.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText("RELEASE", releasePt.x + 7, releasePt.y + 3);

      // ==========================================
      // Predicted path (from impact to stumps — dashed)
      // ==========================================
      const lastTrackedPoint = mappedPoints[mappedPoints.length - 1];
      const predictedPoints = trajectory.predictedPathPoints;

      if (predictedPoints.length > 0) {
        // Build predicted path starting from last tracked point
        const predMapped = [
          { x: lastTrackedPoint.x, y: lastTrackedPoint.y },
          ...predictedPoints.map((p) => ({
            x: pitchLeft + p.x * pitchW,
            y: pitchTop + p.y * pitchH,
          })),
        ];

        // Glow for predicted path
        ctx.save();
        ctx.strokeStyle = isHitting ? "rgba(239, 68, 68, 0.1)" : "rgba(59, 130, 246, 0.1)";
        ctx.lineWidth = 8;
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(predMapped[0].x, predMapped[0].y);
        for (let i = 1; i < predMapped.length; i++) {
          ctx.lineTo(predMapped[i].x, predMapped[i].y);
        }
        ctx.stroke();
        ctx.restore();

        // Dashed line
        ctx.strokeStyle = isHitting ? "rgba(239, 68, 68, 0.7)" : "rgba(59, 130, 246, 0.7)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(predMapped[0].x, predMapped[0].y);
        for (let i = 1; i < predMapped.length; i++) {
          ctx.lineTo(predMapped[i].x, predMapped[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Dots along predicted path
        for (let i = 1; i < predMapped.length; i++) {
          const pt = predMapped[i];
          ctx.fillStyle = isHitting ? "rgba(239, 68, 68, 0.5)" : "rgba(59, 130, 246, 0.5)";
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Label at end of predicted path
        const endPred = predMapped[predMapped.length - 1];
        ctx.fillStyle = isHitting ? "#ef4444" : "#3b82f6";
        ctx.font = "bold 8px ui-monospace, monospace";
        ctx.textAlign = "left";
        ctx.fillText(
          isHitting ? "HITTING" : "MISSING",
          endPred.x + 8, endPred.y + 3
        );
      } else {
        // No predicted path — draw simple dashed line to stumps
        ctx.strokeStyle = isHitting ? "rgba(239, 68, 68, 0.4)" : "rgba(59, 130, 246, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        ctx.moveTo(lastTrackedPoint.x, lastTrackedPoint.y);
        ctx.lineTo(centerX, battingCreaseY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ==========================================
    // Pitch point marker (green circle + crosshair)
    // ==========================================
    if (trajectory.pitchPoint) {
      const px = pitchLeft + trajectory.pitchPoint.x * pitchW;
      const py = pitchTop + trajectory.pitchPoint.y * pitchH;

      // Glow
      const pitchGlow = ctx.createRadialGradient(px, py, 0, px, py, 14);
      pitchGlow.addColorStop(0, "rgba(16, 185, 129, 0.35)");
      pitchGlow.addColorStop(1, "transparent");
      ctx.fillStyle = pitchGlow;
      ctx.beginPath();
      ctx.arc(px, py, 14, 0, Math.PI * 2);
      ctx.fill();

      // Dot
      ctx.fillStyle = "#10b981";
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();

      // Crosshair
      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px - 6, py); ctx.lineTo(px + 6, py);
      ctx.moveTo(px, py - 6); ctx.lineTo(px, py + 6);
      ctx.stroke();

      // Label
      ctx.fillStyle = "#10b981";
      ctx.font = "bold 8px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText("PITCH", px + 8, py - 6);
    }

    // ==========================================
    // Impact point marker (diamond shape)
    // ==========================================
    if (trajectory.impactPoint) {
      const ix = pitchLeft + trajectory.impactPoint.x * pitchW;
      const iy = pitchTop + trajectory.impactPoint.y * pitchH;

      // Glow
      const impactGlow = ctx.createRadialGradient(ix, iy, 0, ix, iy, 12);
      impactGlow.addColorStop(0, "rgba(251, 191, 36, 0.35)");
      impactGlow.addColorStop(1, "transparent");
      ctx.fillStyle = impactGlow;
      ctx.beginPath();
      ctx.arc(ix, iy, 12, 0, Math.PI * 2);
      ctx.fill();

      // Diamond
      ctx.fillStyle = "#fbbf24";
      ctx.beginPath();
      ctx.moveTo(ix, iy - 6);
      ctx.lineTo(ix + 6, iy);
      ctx.lineTo(ix, iy + 6);
      ctx.lineTo(ix - 6, iy);
      ctx.closePath();
      ctx.fill();

      // Label
      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 8px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText("IMPACT", ix + 9, iy + 3);
    }

    // ==========================================
    // Batsman position (near batting crease)
    // ==========================================
    const batsmanX = centerX + 20;
    const batsmanY = battingCreaseY + 8;

    ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
    ctx.beginPath();
    ctx.arc(batsmanX, batsmanY, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "bold 7px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("BAT", batsmanX, batsmanY + 3);

    // ==========================================
    // Stump zone highlight for LBW decisions
    // ==========================================
    if (isHitting) {
      ctx.fillStyle = "rgba(239, 68, 68, 0.06)";
      ctx.fillRect(
        centerX - batStumpGap - 4,
        battingCreaseY - 6,
        batStumpGap * 2 + 8,
        batStumpW + 12,
      );
      ctx.strokeStyle = "rgba(239, 68, 68, 0.25)";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        centerX - batStumpGap - 4,
        battingCreaseY - 6,
        batStumpGap * 2 + 8,
        batStumpW + 12,
      );
    }

    // ==========================================
    // Deviation indicator
    // ==========================================
    if (Math.abs(trajectory.deviation) > 0.5 && trajectory.pitchPoint) {
      const ppx = pitchLeft + trajectory.pitchPoint.x * pitchW;
      const ppy = pitchTop + trajectory.pitchPoint.y * pitchH;
      ctx.fillStyle = "rgba(245, 158, 11, 0.7)";
      ctx.font = "7px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(
        `${trajectory.deviation > 0 ? "→" : "←"} ${Math.abs(trajectory.deviation).toFixed(1)}°`,
        ppx + 22, ppy + 3,
      );
    }

    // ==========================================
    // Ball speed indicator
    // ==========================================
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.font = "8px ui-monospace, monospace";
    ctx.textAlign = "right";
    ctx.fillText(`${trajectory.ballSpeed} km/h`, pitchRight, pitchTop - 4);

    // ==========================================
    // Legend
    // ==========================================
    const legendY = pitchBottom + 18;
    ctx.font = "7px ui-monospace, monospace";
    ctx.textAlign = "left";

    // Tracked path
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(pitchLeft, legendY - 5, 10, 2);
    ctx.fillText("Tracked", pitchLeft + 14, legendY);

    // Predicted path
    ctx.setLineDash([3, 2]);
    ctx.strokeStyle = isHitting ? "#ef4444" : "#3b82f6";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(pitchLeft + 80, legendY - 4);
    ctx.lineTo(pitchLeft + 100, legendY - 4);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillText("Predicted", pitchLeft + 104, legendY);

    // Pitch point
    ctx.fillStyle = "#10b981";
    ctx.beginPath();
    ctx.arc(pitchLeft + 175, legendY - 4, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText("Pitch", pitchLeft + 182, legendY);

    // Impact point
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath();
    ctx.moveTo(pitchLeft + 220, legendY - 8);
    ctx.lineTo(pitchLeft + 224, legendY - 4);
    ctx.lineTo(pitchLeft + 220, legendY);
    ctx.lineTo(pitchLeft + 216, legendY - 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillText("Impact", pitchLeft + 228, legendY);
  }, [analysisResult]);

  return (
    <div className="w-full">
      <canvas
        ref={canvasRef}
        width={460}
        height={320}
        className="w-full h-auto rounded-lg"
      />
    </div>
  );
}
