'use client'

import React, { useRef, useEffect, useState, useCallback } from "react";
import type { AnalysisResult } from "@/lib/types";

interface PitchPathVideoProps {
  analysisResult: AnalysisResult;
  isPlaying: boolean;
  playbackSpeed: number;
  onProgress?: (progress: number) => void;
}

/**
 * Animated 3D perspective cricket pitch that shows:
 * 1. The actual tracked ball path (amber) from release to impact
 * 2. The predicted path (dashed red/blue) from impact to stumps
 * 3. Stumps, crease lines, pitch markings, batsman silhouette
 * 4. An animating ball that traces the path in sync with video playback
 */
export default function PitchPathVideo({
  analysisResult,
  isPlaying,
  playbackSpeed,
  onProgress,
}: PitchPathVideoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const progressRef = useRef(0);
  const isPlayingRef = useRef(isPlaying);
  const playbackSpeedRef = useRef(playbackSpeed);
  const lastTimeRef = useRef<number>(0);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    playbackSpeedRef.current = playbackSpeed;
  }, [playbackSpeed]);

  // Handle resize
  const updateDimensions = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDimensions({ width: rect.width, height: rect.height });
  }, []);

  useEffect(() => {
    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    if (containerRef.current) {
      observer.observe(containerRef.current);
    }
    return () => observer.disconnect();
  }, [updateDimensions]);

  // 3D perspective transformation
  // Maps pitch coordinates (0-1) to 3D perspective screen coordinates
  const pitchToScreen = useCallback((
    px: number, py: number, // pitch coords (0-1)
    w: number, h: number,
    config: { vanishX: number; vanishY: number; leftNear: number; rightNear: number; topNear: number; bottomNear: number }
  ) => {
    // py=0 is bowling end (far/vanishing), py=1 is batting end (near/bottom)
    const t = Math.pow(py, 0.85); // perspective compression
    const screenX = config.vanishX + (px - 0.5) * (config.rightNear - config.leftNear) * t;
    const screenY = config.vanishY + (config.bottomNear - config.vanishY) * t;
    return { x: screenX, y: screenY };
  }, []);

  const drawScene = useCallback((progress: number, w: number, h: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.fillStyle = "#0a1628";
    ctx.fillRect(0, 0, w, h);

    // Perspective config
    const vanishX = w * 0.5;
    const vanishY = h * 0.18;
    const leftNear = w * 0.08;
    const rightNear = w * 0.92;
    const topNear = h * 0.12;
    const bottomNear = h * 0.88;

    const config = { vanishX, vanishY, leftNear, rightNear, topNear, bottomNear };

    // Helper to get pitch point on screen
    const toScreen = (px: number, py: number) =>
      pitchToScreen(px, py, w, h, config);

    // ==========================================
    // Draw outfield (dark green gradient)
    // ==========================================
    const outfieldGrad = ctx.createRadialGradient(
      vanishX, vanishY + 60, 10,
      vanishX, vanishY + 60, h * 0.8
    );
    outfieldGrad.addColorStop(0, "#0d2818");
    outfieldGrad.addColorStop(0.5, "#0f3319");
    outfieldGrad.addColorStop(1, "#081a0f");
    ctx.fillStyle = outfieldGrad;
    ctx.fillRect(0, 0, w, h);

    // ==========================================
    // Draw pitch surface (perspective quad)
    // ==========================================
    const pTL = toScreen(0, 0);     // top-left bowling
    const pTR = toScreen(1, 0);     // top-right bowling
    const pBL = toScreen(0, 1);     // bottom-left batting
    const pBR = toScreen(1, 1);     // bottom-right batting

    // Pitch fill
    const pitchGrad = ctx.createLinearGradient(vanishX, vanishY, vanishX, bottomNear);
    pitchGrad.addColorStop(0, "#1a5c2e");
    pitchGrad.addColorStop(0.3, "#1e6b35");
    pitchGrad.addColorStop(0.5, "#22753a");
    pitchGrad.addColorStop(0.7, "#1e6b35");
    pitchGrad.addColorStop(1, "#1a5c2e");

    ctx.beginPath();
    ctx.moveTo(pTL.x, pTL.y);
    ctx.lineTo(pTR.x, pTR.y);
    ctx.lineTo(pBR.x, pBR.y);
    ctx.lineTo(pBL.x, pBL.y);
    ctx.closePath();
    ctx.fillStyle = pitchGrad;
    ctx.fill();

    // Pitch boundary
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Mowed grass stripes (perspective)
    ctx.fillStyle = "rgba(0, 0, 0, 0.04)";
    for (let i = 0; i < 20; i += 2) {
      const y1 = i / 20;
      const y2 = (i + 1) / 20;
      const s1L = toScreen(0, y1);
      const s1R = toScreen(1, y1);
      const s2L = toScreen(0, y2);
      const s2R = toScreen(1, y2);
      ctx.beginPath();
      ctx.moveTo(s1L.x, s1L.y);
      ctx.lineTo(s1R.x, s1R.y);
      ctx.lineTo(s2R.x, s2R.y);
      ctx.lineTo(s2L.x, s2L.y);
      ctx.closePath();
      ctx.fill();
    }

    // ==========================================
    // Crease lines
    // ==========================================
    const bowlingCreaseY = 0.04;
    const battingCreaseY = 0.92;

    // Bowling crease
    const bcL = toScreen(0.02, bowlingCreaseY);
    const bcR = toScreen(0.98, bowlingCreaseY);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(bcL.x, bcL.y);
    ctx.lineTo(bcR.x, bcR.y);
    ctx.stroke();

    // Batting crease
    const btL = toScreen(0.02, battingCreaseY);
    const btR = toScreen(0.98, battingCreaseY);
    ctx.beginPath();
    ctx.moveTo(btL.x, btL.y);
    ctx.lineTo(btR.x, btR.y);
    ctx.stroke();

    // ==========================================
    // Bowling end stumps (far, small)
    // ==========================================
    const stumpCenter = 0.5;
    const stumpWidthNear = 0.035;
    const stumpWidthFar = 0.015;

    // Bowling stumps
    const bsCenter = toScreen(stumpCenter, bowlingCreaseY);
    const bsLeft = toScreen(stumpCenter - stumpWidthFar, bowlingCreaseY);
    const bsRight = toScreen(stumpCenter + stumpWidthFar, bowlingCreaseY);
    const bsTop = toScreen(stumpCenter, bowlingCreaseY - 0.015);
    const bsBottom = toScreen(stumpCenter, bowlingCreaseY + 0.015);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 1;
    for (const sx of [stumpCenter - stumpWidthFar, stumpCenter, stumpCenter + stumpWidthFar]) {
      const s = toScreen(sx, bowlingCreaseY);
      const st = toScreen(sx, bowlingCreaseY - 0.015);
      const sb = toScreen(sx, bowlingCreaseY + 0.015);
      ctx.beginPath();
      ctx.moveTo(st.x, st.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
    }
    // Bails
    ctx.lineWidth = 0.8;
    const blLeft = toScreen(stumpCenter - stumpWidthFar, bowlingCreaseY - 0.015);
    const blRight = toScreen(stumpCenter + stumpWidthFar, bowlingCreaseY - 0.015);
    ctx.beginPath();
    ctx.moveTo(blLeft.x, blLeft.y);
    ctx.lineTo(blRight.x, blRight.y);
    ctx.stroke();

    // ==========================================
    // Batting end stumps (near, larger)
    // ==========================================
    const batStumpH = 0.03;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
    ctx.lineWidth = 2;
    for (const sx of [stumpCenter - stumpWidthNear, stumpCenter, stumpCenter + stumpWidthNear]) {
      const st = toScreen(sx, battingCreaseY - batStumpH / 2);
      const sb = toScreen(sx, battingCreaseY + batStumpH / 2);
      ctx.beginPath();
      ctx.moveTo(st.x, st.y);
      ctx.lineTo(sb.x, sb.y);
      ctx.stroke();
    }
    // Bails
    ctx.lineWidth = 1.5;
    const batBailLeft = toScreen(stumpCenter - stumpWidthNear, battingCreaseY - batStumpH / 2);
    const batBailRight = toScreen(stumpCenter + stumpWidthNear, battingCreaseY - batStumpH / 2);
    ctx.beginPath();
    ctx.moveTo(batBailLeft.x, batBailLeft.y);
    ctx.lineTo(batBailRight.x, batBailRight.y);
    ctx.stroke();

    // ==========================================
    // Batsman silhouette
    // ==========================================
    const batX = stumpCenter + 0.06;
    const batY = battingCreaseY + 0.02;
    const batScreen = toScreen(batX, batY);

    // Body
    ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
    ctx.beginPath();
    ctx.ellipse(batScreen.x, batScreen.y, w * 0.025, h * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Label
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.font = `${Math.max(8, w * 0.02)}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.fillText("BATSMAN", batScreen.x, batScreen.y + h * 0.05);

    // ==========================================
    // Labels
    // ==========================================
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.font = `bold ${Math.max(8, w * 0.022)}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    const bowlLabel = toScreen(0.5, -0.03);
    ctx.fillText("BOWLING END", bowlLabel.x, bowlLabel.y);
    const batLabel = toScreen(0.5, 1.03);
    ctx.fillText("BATSMAN END", batLabel.x, batLabel.y);

    // ==========================================
    // Ball trajectory data
    // ==========================================
    const { trajectory, frameData } = analysisResult;
    const isHitting = analysisResult.decision === "OUT";

    if (frameData.length < 2) return;

    // Map frameData to pitch coordinates
    // frameData.x, frameData.y are normalized 0-1 from video
    // We map them to pitch coordinates for the 3D view
    const totalPoints = frameData.length;
    const visibleCount = Math.floor(progress * totalPoints);

    if (visibleCount < 2) {
      // Just show the release point
      if (frameData.length > 0) {
        const rp = toScreen(frameData[0].x, frameData[0].y);
        ctx.fillStyle = "#22d3ee";
        ctx.beginPath();
        ctx.arc(rp.x, rp.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `bold ${Math.max(8, w * 0.018)}px ui-monospace, monospace`;
        ctx.textAlign = "left";
        ctx.fillText("RELEASE", rp.x + 8, rp.y + 3);
      }
      return;
    }

    // ==========================================
    // Draw actual tracked path (amber/orange glow)
    // ==========================================
    const trackedPoints = frameData.slice(0, visibleCount + 1).map(p =>
      toScreen(p.x, p.y)
    );

    // Outer glow
    ctx.save();
    ctx.strokeStyle = "rgba(251, 191, 36, 0.08)";
    ctx.lineWidth = 12;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(trackedPoints[0].x, trackedPoints[0].y);
    for (let i = 1; i < trackedPoints.length; i++) {
      ctx.lineTo(trackedPoints[i].x, trackedPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();

    // Inner glow
    ctx.save();
    ctx.strokeStyle = "rgba(251, 191, 36, 0.2)";
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(trackedPoints[0].x, trackedPoints[0].y);
    for (let i = 1; i < trackedPoints.length; i++) {
      ctx.lineTo(trackedPoints[i].x, trackedPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();

    // Main tracked line
    ctx.strokeStyle = "rgba(251, 191, 36, 0.9)";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(trackedPoints[0].x, trackedPoints[0].y);
    for (let i = 1; i < trackedPoints.length; i++) {
      ctx.lineTo(trackedPoints[i].x, trackedPoints[i].y);
    }
    ctx.stroke();

    // Dots along tracked path
    for (let i = 0; i < trackedPoints.length; i++) {
      const pt = trackedPoints[i];
      const t = i / (totalPoints - 1);
      let dotColor = "#f59e0b";
      if (t > 0.7) dotColor = isHitting ? "#ef4444" : "#3b82f6";

      ctx.fillStyle = dotColor;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Release point marker
    const releasePt = trackedPoints[0];
    ctx.fillStyle = "#22d3ee";
    ctx.beginPath();
    ctx.arc(releasePt.x, releasePt.y, 5, 0, Math.PI * 2);
    ctx.fill();

    // Release glow
    const releaseGlow = ctx.createRadialGradient(
      releasePt.x, releasePt.y, 0,
      releasePt.x, releasePt.y, 15
    );
    releaseGlow.addColorStop(0, "rgba(34, 211, 238, 0.3)");
    releaseGlow.addColorStop(1, "transparent");
    ctx.fillStyle = releaseGlow;
    ctx.beginPath();
    ctx.arc(releasePt.x, releasePt.y, 15, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#22d3ee";
    ctx.font = `bold ${Math.max(9, w * 0.02)}px ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.fillText("RELEASE", releasePt.x + 9, releasePt.y + 3);

    // ==========================================
    // Draw predicted path (after ball reaches impact)
    // ==========================================
    const impactProgress = 0.75; // show prediction after 75% of path
    if (progress > impactProgress && trajectory.predictedPathPoints.length > 0) {
      const predProgress = Math.min(
        1.0,
        (progress - impactProgress) / (1.0 - impactProgress)
      );
      const predVisibleCount = Math.floor(predProgress * trajectory.predictedPathPoints.length);

      const lastTrackedScreen = trackedPoints[trackedPoints.length - 1];

      // Predicted path points
      const predScreenPoints = [
        lastTrackedScreen,
        ...trajectory.predictedPathPoints.slice(0, predVisibleCount + 1).map(p =>
          toScreen(p.x, p.y)
        )
      ];

      if (predScreenPoints.length > 1) {
        // Glow
        ctx.save();
        ctx.strokeStyle = isHitting ? "rgba(239, 68, 68, 0.08)" : "rgba(59, 130, 246, 0.08)";
        ctx.lineWidth = 10;
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(predScreenPoints[0].x, predScreenPoints[0].y);
        for (let i = 1; i < predScreenPoints.length; i++) {
          ctx.lineTo(predScreenPoints[i].x, predScreenPoints[i].y);
        }
        ctx.stroke();
        ctx.restore();

        // Dashed line
        ctx.strokeStyle = isHitting ? "rgba(239, 68, 68, 0.7)" : "rgba(59, 130, 246, 0.7)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(predScreenPoints[0].x, predScreenPoints[0].y);
        for (let i = 1; i < predScreenPoints.length; i++) {
          ctx.lineTo(predScreenPoints[i].x, predScreenPoints[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Dots
        for (let i = 1; i < predScreenPoints.length; i++) {
          const pt = predScreenPoints[i];
          ctx.fillStyle = isHitting ? "rgba(239, 68, 68, 0.5)" : "rgba(59, 130, 246, 0.5)";
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // Label at end
        const endPred = predScreenPoints[predScreenPoints.length - 1];
        ctx.fillStyle = isHitting ? "#ef4444" : "#3b82f6";
        ctx.font = `bold ${Math.max(9, w * 0.022)}px ui-monospace, monospace`;
        ctx.textAlign = "left";
        ctx.fillText(
          isHitting ? "HITTING STUMPS" : "MISSING STUMPS",
          endPred.x + 10, endPred.y + 3
        );

        // Impact point label
        ctx.fillStyle = "#fbbf24";
        ctx.font = `bold ${Math.max(8, w * 0.018)}px ui-monospace, monospace`;
        ctx.fillText("IMPACT", lastTrackedScreen.x + 10, lastTrackedScreen.y - 8);
      }
    }

    // ==========================================
    // Pitch point marker
    // ==========================================
    if (trajectory.pitchPoint && progress > 0.3) {
      const pp = toScreen(trajectory.pitchPoint.x, trajectory.pitchPoint.y);
      const pitchGlow = ctx.createRadialGradient(pp.x, pp.y, 0, pp.x, pp.y, 14);
      pitchGlow.addColorStop(0, "rgba(16, 185, 129, 0.4)");
      pitchGlow.addColorStop(1, "transparent");
      ctx.fillStyle = pitchGlow;
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, 14, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#10b981";
      ctx.beginPath();
      ctx.arc(pp.x, pp.y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Crosshair
      ctx.strokeStyle = "#10b981";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pp.x - 6, pp.y); ctx.lineTo(pp.x + 6, pp.y);
      ctx.moveTo(pp.x, pp.y - 6); ctx.lineTo(pp.x, pp.y + 6);
      ctx.stroke();

      ctx.font = `bold ${Math.max(8, w * 0.018)}px ui-monospace, monospace`;
      ctx.textAlign = "left";
      ctx.fillText("PITCH", pp.x + 9, pp.y - 6);
    }

    // ==========================================
    // Current ball position (animated)
    // ==========================================
    if (visibleCount > 0 && visibleCount < totalPoints) {
      const current = frameData[Math.min(visibleCount, totalPoints - 1)];
      const cp = toScreen(current.x, current.y);
      const t = visibleCount / (totalPoints - 1);

      let ballColor = "#f59e0b";
      if (t >= 0.7) ballColor = isHitting ? "#ef4444" : "#3b82f6";

      // Large glow
      const largeGlow = ctx.createRadialGradient(cp.x, cp.y, 0, cp.x, cp.y, 20);
      largeGlow.addColorStop(0, ballColor + "60");
      largeGlow.addColorStop(0.5, ballColor + "20");
      largeGlow.addColorStop(1, "transparent");
      ctx.fillStyle = largeGlow;
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, 20, 0, Math.PI * 2);
      ctx.fill();

      // Ball
      ctx.fillStyle = ballColor;
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, 5, 0, Math.PI * 2);
      ctx.fill();

      // Highlight
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath();
      ctx.arc(cp.x - 1.5, cp.y - 1.5, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // ==========================================
    // Stump hit zone highlight
    // ==========================================
    if (isHitting && progress > 0.9) {
      const stumpZoneAlpha = Math.min(1, (progress - 0.9) / 0.1);
      const sL = toScreen(stumpCenter - stumpWidthNear - 0.01, battingCreaseY - batStumpH / 2 - 0.01);
      const sR = toScreen(stumpCenter + stumpWidthNear + 0.01, battingCreaseY + batStumpH / 2 + 0.01);

      ctx.fillStyle = `rgba(239, 68, 68, ${0.15 * stumpZoneAlpha})`;
      ctx.fillRect(sL.x, sL.y, sR.x - sL.x, sR.y - sL.y);
      ctx.strokeStyle = `rgba(239, 68, 68, ${0.4 * stumpZoneAlpha})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sL.x, sL.y, sR.x - sL.x, sR.y - sL.y);
    }

    // ==========================================
    // Ball speed indicator
    // ==========================================
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.font = `${Math.max(9, w * 0.02)}px ui-monospace, monospace`;
    ctx.textAlign = "right";
    ctx.fillText(`${trajectory.ballSpeed} km/h`, w - 15, 22);

    // ==========================================
    // Legend
    // ==========================================
    const legendY = h - 15;
    ctx.font = `${Math.max(7, w * 0.016)}px ui-monospace, monospace`;
    ctx.textAlign = "left";

    // Tracked
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(12, legendY - 4, 10, 2.5);
    ctx.fillText("Tracked", 26, legendY);

    // Predicted
    ctx.setLineDash([3, 2]);
    ctx.strokeStyle = isHitting ? "#ef4444" : "#3b82f6";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(90, legendY - 3);
    ctx.lineTo(110, legendY - 3);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = isHitting ? "#ef4444" : "#3b82f6";
    ctx.fillText("Predicted", 114, legendY);

    // Pitch
    ctx.fillStyle = "#10b981";
    ctx.beginPath();
    ctx.arc(185, legendY - 3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText("Pitch", 192, legendY);

    // Release
    ctx.fillStyle = "#22d3ee";
    ctx.beginPath();
    ctx.arc(232, legendY - 3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText("Release", 239, legendY);

    // ==========================================
    // "3D BALL TRACKING" label
    // ==========================================
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.font = `${Math.max(8, w * 0.017)}px ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.fillText("3D PITCH TRACKING", 12, 20);

  }, [analysisResult, pitchToScreen]);

  // Animation loop
  useEffect(() => {
    let stopped = false;

    const animate = (timestamp: number) => {
      if (stopped) return;

      const w = dimensions.width;
      const h = dimensions.height;
      if (w === 0 || h === 0) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      if (lastTimeRef.current === 0) {
        lastTimeRef.current = timestamp;
      }

      const deltaMs = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;

      // Animate progress based on playback speed
      if (isPlayingRef.current) {
        // Full animation duration: 3 seconds at 1x speed
        const increment = (deltaMs / 3000) * playbackSpeedRef.current;
        progressRef.current = Math.min(1.0, progressRef.current + increment);
        onProgress?.(progressRef.current);
      }

      drawScene(progressRef.current, w, h);

      // If completed and not playing, just keep drawing the final frame
      if (progressRef.current >= 1.0) {
        drawScene(1.0, w, h);
        return;
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      stopped = true;
      cancelAnimationFrame(animFrameRef.current);
    };
  }, [dimensions, drawScene, onProgress]);

  // Reset progress when result changes
  useEffect(() => {
    progressRef.current = 0;
    lastTimeRef.current = 0;
  }, [analysisResult]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas
        ref={canvasRef}
        style={{
          width: dimensions.width || "100%",
          height: dimensions.height || "100%",
        }}
        className="w-full h-full rounded-xl"
      />
    </div>
  );
}
