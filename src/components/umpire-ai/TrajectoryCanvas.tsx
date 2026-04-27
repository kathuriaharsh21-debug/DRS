'use client'

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisResult } from "@/lib/types";

interface TrajectoryCanvasProps {
  frameData: AnalysisResult["frameData"];
  isAnimating: boolean;
  decision: "OUT" | "NOT OUT";
}

/** Draw the complete trajectory scene on a canvas context */
function drawTrajectory(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  frameData: AnalysisResult["frameData"],
  visibleCount: number,
  decision: "OUT" | "NOT OUT"
) {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  if (frameData.length === 0) return;

  const visiblePoints = frameData.slice(0, visibleCount + 1);
  const isHitting = decision === "OUT";

  // Draw stumps (at the right side of the canvas)
  const stumpX = width * 0.82;
  const stumpTop = height * 0.4;
  const stumpBottom = height * 0.7;
  const stumpWidth = 3;
  const stumpGap = 12;

  ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
  ctx.lineWidth = stumpWidth;
  ctx.lineCap = "round";

  // Three stumps
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.moveTo(stumpX + i * stumpGap, stumpTop);
    ctx.lineTo(stumpX + i * stumpGap, stumpBottom);
    ctx.stroke();
  }

  // Bails
  ctx.lineWidth = 2;
  for (let i = -1; i <= 1; i += 2) {
    ctx.beginPath();
    ctx.moveTo(stumpX + (i > 0 ? 0 : -stumpGap), stumpTop);
    ctx.lineTo(stumpX + (i > 0 ? stumpGap : 0), stumpTop);
    ctx.stroke();
  }

  if (visiblePoints.length < 2) return;

  // Draw trajectory path with gradient
  const gradient = ctx.createLinearGradient(
    visiblePoints[0].x * width,
    visiblePoints[0].y * height,
    visiblePoints[visiblePoints.length - 1].x * width,
    visiblePoints[visiblePoints.length - 1].y * height
  );

  if (isHitting) {
    gradient.addColorStop(0, "#10b981");
    gradient.addColorStop(0.4, "#f59e0b");
    gradient.addColorStop(0.7, "#f59e0b");
    gradient.addColorStop(1, "#ef4444");
  } else {
    gradient.addColorStop(0, "#10b981");
    gradient.addColorStop(0.4, "#f59e0b");
    gradient.addColorStop(0.7, "#f59e0b");
    gradient.addColorStop(1, "#3b82f6");
  }

  // Draw path line
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(visiblePoints[0].x * width, visiblePoints[0].y * height);
  for (let i = 1; i < visiblePoints.length; i++) {
    ctx.lineTo(visiblePoints[i].x * width, visiblePoints[i].y * height);
  }
  ctx.stroke();

  // Draw glow effect on path
  ctx.strokeStyle = isHitting
    ? "rgba(239, 68, 68, 0.15)"
    : "rgba(59, 130, 246, 0.15)";
  ctx.lineWidth = 8;
  ctx.filter = "blur(4px)";
  ctx.beginPath();
  ctx.moveTo(visiblePoints[0].x * width, visiblePoints[0].y * height);
  for (let i = 1; i < visiblePoints.length; i++) {
    ctx.lineTo(visiblePoints[i].x * width, visiblePoints[i].y * height);
  }
  ctx.stroke();
  ctx.filter = "none";

  // Draw dots at each trajectory point
  for (let i = 0; i < visiblePoints.length; i++) {
    const point = visiblePoints[i];
    const x = point.x * width;
    const y = point.y * height;
    const t = i / (frameData.length - 1);

    let dotColor: string;
    if (t < 0.4) dotColor = "#10b981";
    else if (t < 0.7) dotColor = "#f59e0b";
    else dotColor = isHitting ? "#ef4444" : "#3b82f6";

    // Outer glow
    const glowRadius = i === visiblePoints.length - 1 ? 12 : 6;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
    glow.addColorStop(0, dotColor + "40");
    glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fill();

    // Inner dot
    const dotRadius = i === visiblePoints.length - 1 ? 4 : 2;
    ctx.fillStyle = dotColor;
    ctx.beginPath();
    ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw current ball position (larger pulsing ball)
  if (visiblePoints.length > 0) {
    const current = visiblePoints[visiblePoints.length - 1];
    const x = current.x * width;
    const y = current.y * height;
    const t = (visiblePoints.length - 1) / (frameData.length - 1);

    let ballColor = "#f59e0b";
    if (t >= 0.7) ballColor = isHitting ? "#ef4444" : "#3b82f6";

    // Large glow
    const largeGlow = ctx.createRadialGradient(x, y, 0, x, y, 20);
    largeGlow.addColorStop(0, ballColor + "60");
    largeGlow.addColorStop(0.5, ballColor + "20");
    largeGlow.addColorStop(1, "transparent");
    ctx.fillStyle = largeGlow;
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();

    // Ball
    ctx.fillStyle = ballColor;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();

    // White center highlight
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath();
    ctx.arc(x - 1, y - 1, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw pitch point marker
  if (visiblePoints.length >= Math.floor(frameData.length * 0.4)) {
    const pitchPoint = frameData[Math.floor(frameData.length * 0.4)];
    const px = pitchPoint.x * width;
    const py = pitchPoint.y * height;

    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.arc(px, py, 8, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(px - 5, py);
    ctx.lineTo(px + 5, py);
    ctx.moveTo(px, py - 5);
    ctx.lineTo(px, py + 5);
    ctx.stroke();

    ctx.fillStyle = "#10b981";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText("PITCH", px + 12, py + 3);
  }

  // Draw impact point marker
  if (visiblePoints.length >= Math.floor(frameData.length * 0.7)) {
    const impactPoint = frameData[Math.floor(frameData.length * 0.7)];
    const ix = impactPoint.x * width;
    const iy = impactPoint.y * height;

    ctx.strokeStyle = "#f59e0b";
    ctx.lineWidth = 1.5;

    ctx.beginPath();
    ctx.moveTo(ix, iy - 8);
    ctx.lineTo(ix + 8, iy);
    ctx.lineTo(ix, iy + 8);
    ctx.lineTo(ix - 8, iy);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = "#f59e0b";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText("IMPACT", ix + 12, iy + 3);
  }

  // If hitting stumps, draw prediction zone
  if (visiblePoints.length >= frameData.length && isHitting) {
    ctx.fillStyle = "rgba(239, 68, 68, 0.08)";
    ctx.strokeStyle = "rgba(239, 68, 68, 0.3)";
    ctx.lineWidth = 1;

    ctx.fillRect(
      stumpX - stumpGap - 5,
      stumpTop - 5,
      stumpGap * 2 + 10,
      stumpBottom - stumpTop + 10
    );
    ctx.strokeRect(
      stumpX - stumpGap - 5,
      stumpTop - 5,
      stumpGap * 2 + 10,
      stumpBottom - stumpTop + 10
    );

    ctx.fillStyle = "#ef4444";
    ctx.font = "bold 11px ui-monospace, monospace";
    ctx.fillText("HITTING WICKET", stumpX - 45, stumpBottom + 20);
  }
}

/** Canvas overlay that animates the ball trajectory on top of the video */
export default function TrajectoryCanvas({
  frameData,
  isAnimating,
  decision,
}: TrajectoryCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Store latest props in refs for use inside animation callbacks
  const frameDataRef = useRef(frameData);
  const decisionRef = useRef(decision);

  useEffect(() => {
    frameDataRef.current = frameData;
    decisionRef.current = decision;
  });

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

  // Perform a single draw using the latest refs
  const drawFrame = useCallback((visibleCount: number) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const rect = container.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w === 0 || h === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    drawTrajectory(ctx, w, h, frameDataRef.current, visibleCount, decisionRef.current);
  }, []);

  // Static draw when dimensions change (non-animating state)
  useEffect(() => {
    if (dimensions.width > 0 && dimensions.height > 0) {
      drawFrame(frameDataRef.current.length - 1);
    }
  }, [dimensions, drawFrame]);

  // Animation loop — only setState inside rAF callbacks (which are async)
  useEffect(() => {
    if (!isAnimating || frameData.length === 0) return;

    let index = 0;
    let stopped = false;

    const animate = () => {
      if (stopped) return;
      drawFrame(index);
      if (index < frameData.length - 1) {
        index += 1;
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    // Start animation with slight delay
    const timeout = setTimeout(() => {
      animationRef.current = requestAnimationFrame(animate);
    }, 300);

    return () => {
      stopped = true;
      clearTimeout(timeout);
      cancelAnimationFrame(animationRef.current);
    };
  }, [isAnimating, frameData, drawFrame]);

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none">
      <canvas
        ref={canvasRef}
        style={{
          width: dimensions.width || "100%",
          height: dimensions.height || "100%",
        }}
        className="w-full h-full"
      />
    </div>
  );
}
