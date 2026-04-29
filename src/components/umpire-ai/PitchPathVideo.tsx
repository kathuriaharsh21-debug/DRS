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
 * 3D cricket pitch rendered from the MAIN UMPIRE's perspective.
 *
 * Camera setup (real world):
 *   - Eye height: 6 ft (183 cm) above ground
 *   - Position: 4 ft (122 cm) behind the bowling popping crease
 *   - Lateral: centre wicket line (x = 0)
 *
 * This means:
 *   - Bowling stumps are ~4 ft away at ground level → appear LARGE at
 *     the bottom of the frame.
 *   - The bowling crease is ~4 ft away → just in front of the stumps.
 *   - The pitch stretches ~22 yards (~66 ft) to the batting end.
 *   - Batting stumps are ~70 ft away → appear SMALL near the top.
 *
 * Perspective projection:
 *   We project 3D world coordinates (x_right, y_forward, z_up) onto the
 *   2D canvas using a pinhole camera model.  The camera looks forward
 *   along +y with +z as up.
 *
 *   screen_x  =  focal * x / y
 *   screen_y  =  focal * (cam_z - z) / y   (ground is below eye level)
 *
 *   We scale to fit the canvas and flip y so that closer objects (small y)
 *   appear at the BOTTOM and farther objects at the TOP.
 */

// ---- Physical constants (feet) ----
const CAM_Z = 6.0;           // eye height in feet
const CAM_Y = -4.0;          // 4 ft BEHIND bowling crease (negative = behind)
const PITCH_LENGTH = 66.0;   // 22 yards in feet
const BOWLING_CREASE_Y = 0;  // bowling crease at origin
const BATTING_CREASE_Y = PITCH_LENGTH;
const STUMP_HEIGHT = 2.75;   // stump height in feet (28 inches)
const STUMP_SPREAD = 0.75;   // half-width between off & leg stump (9 inches)
const BALL_RADIUS_FT = 0.14; // cricket ball radius ~1.4 inches

// ---- Canvas / projection ----
const FOCAL = 300; // focal length in pixels (controls field of view)

/** Project a 3D point (world feet) to canvas pixels. */
function project(
  wx: number,   // rightward from centre line (feet)
  wy: number,   // forward from bowling crease (feet)
  wz: number,   // height above ground (feet)
  camY: number,
  camZ: number,
  cx: number,    // canvas centre x
  cy: number,    // canvas "horizon" y
  flip: number,  // 1 or -1
): { x: number; y: number; scale: number } | null {
  const dy = wy - camY; // distance forward from camera
  if (dy <= 0.2) return null; // behind or too close to camera
  const sx = cx + (FOCAL * wx) / dy;
  const sy = cy + flip * (FOCAL * (camZ - wz)) / dy; // ground below eye
  const scale = FOCAL / dy;
  return { x: sx, y: sy, scale };
}

/** Draw a line between two 3D points on ctx. */
function drawLine3D(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  camY: number, camZ: number, cx: number, cy: number, flip: number,
  style: string, width: number = 1, dash: number[] = []
) {
  const a = project(x1, y1, z1, camY, camZ, cx, cy, flip);
  const b = project(x2, y2, z2, camY, camZ, cx, cy, flip);
  if (!a || !b) return;
  ctx.save();
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  if (dash.length) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

/** Draw a stump set at a given y position along the pitch. */
function drawStumps3D(
  ctx: CanvasRenderingContext2D,
  y: number,
  camY: number, camZ: number, cx: number, cy: number, flip: number,
  color: string, width: number, bailWidth: number
) {
  const positions = [-STUMP_SPREAD, 0, STUMP_SPREAD];
  const ground = 0;
  const top = STUMP_HEIGHT;

  for (const sx of positions) {
    const bot = project(sx, y, ground, camY, camZ, cx, cy, flip);
    const tp = project(sx, y, top, camY, camZ, cx, cy, flip);
    if (bot && tp) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(bot.x, bot.y);
      ctx.lineTo(tp.x, tp.y);
      ctx.stroke();
    }
  }

  // Bails (horizontal bars connecting tops of stumps)
  for (let i = 0; i < 2; i++) {
    const a = project(positions[i], y, top, camY, camZ, cx, cy, flip);
    const b = project(positions[i + 1], y, top, camY, camZ, cx, cy, flip);
    if (a && b) {
      ctx.strokeStyle = color;
      ctx.lineWidth = bailWidth;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
}

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

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { playbackSpeedRef.current = playbackSpeed; }, [playbackSpeed]);

  const updateDimensions = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setDimensions({ width: rect.width, height: rect.height });
  }, []);

  useEffect(() => {
    updateDimensions();
    const observer = new ResizeObserver(updateDimensions);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [updateDimensions]);

  /**
   * Map a frameData normalised coordinate (0-1) to a 3D world position
   * on the pitch surface (z=0).
   *
   * The ball trajectory from the backend is in normalised image coordinates
   * where y goes from 0 (top of frame / bowling end) to 1 (bottom / batting end).
   * We map this to world y: 0 → bowling crease area, 1 → batting crease area.
   * x: 0.5 = centre line; 0 = far left; 1 = far right.
   */
  const normToWorld = useCallback((nx: number, ny: number) => {
    // ny=0 → bowling end (y=0..2 ft), ny=1 → batting end (y≈66 ft)
    const worldY = 2 + ny * (PITCH_LENGTH - 4);
    // nx: 0→left (-3 ft from centre), 0.5→centre, 1→right (+3 ft)
    const worldX = (nx - 0.5) * 6;
    return { x: worldX, y: worldY, z: 0 };
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

    // Camera projection parameters
    const cx = w * 0.5;   // canvas centre x
    const cy = h * 0.38;  // horizon line (slightly above centre)
    const flip = 1;        // positive flip: ground below horizon

    const camY = CAM_Y;
    const camZ = CAM_Z;

    // =============================================
    // Sky / background
    // =============================================
    const skyGrad = ctx.createLinearGradient(0, 0, 0, cy);
    skyGrad.addColorStop(0, "#0a1628");
    skyGrad.addColorStop(0.5, "#0f1f38");
    skyGrad.addColorStop(1, "#162d4a");
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, cy + 10);

    // =============================================
    // Outfield (ground)
    // =============================================
    const groundGrad = ctx.createLinearGradient(0, cy, 0, h);
    groundGrad.addColorStop(0, "#0d2818");
    groundGrad.addColorStop(0.3, "#14532d");
    groundGrad.addColorStop(0.6, "#166534");
    groundGrad.addColorStop(1, "#14532d");
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, cy - 2, w, h - cy + 4);

    // =============================================
    // Pitch surface (perspective quad)
    // =============================================
    const pitchHalfWidth = 4.5; // feet (pitch is 10 ft wide, but we show ~9ft for visual)

    // Four corners of the pitch in world coords (z=0, ground)
    const corners = [
      { wx: -pitchHalfWidth, wy: BOWLING_CREASE_Y, wz: 0 },
      { wx:  pitchHalfWidth, wy: BOWLING_CREASE_Y, wz: 0 },
      { wx:  pitchHalfWidth, wy: BATTING_CREASE_Y, wz: 0 },
      { wx: -pitchHalfWidth, wy: BATTING_CREASE_Y, wz: 0 },
    ];

    const projected = corners.map(c =>
      project(c.wx, c.wy, c.wz, camY, camZ, cx, cy, flip)
    );

    if (projected.every(Boolean)) {
      const pts = projected as NonNullable<typeof projected>[0][];

      // Pitch fill with gradient
      const pitchGrad = ctx.createLinearGradient(cx, pts[0].y, cx, pts[2].y);
      pitchGrad.addColorStop(0, "#1a5c2e");
      pitchGrad.addColorStop(0.2, "#1e6b35");
      pitchGrad.addColorStop(0.5, "#22753a");
      pitchGrad.addColorStop(0.8, "#1e6b35");
      pitchGrad.addColorStop(1, "#1a5c2e");

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = pitchGrad;
      ctx.fill();

      // Mowed grass stripes
      const stripeCount = 24;
      for (let i = 0; i < stripeCount; i += 2) {
        const y1 = BOWLING_CREASE_Y + (i / stripeCount) * PITCH_LENGTH;
        const y2 = BOWLING_CREASE_Y + ((i + 1) / stripeCount) * PITCH_LENGTH;
        const s1L = project(-pitchHalfWidth, y1, 0, camY, camZ, cx, cy, flip);
        const s1R = project(pitchHalfWidth, y1, 0, camY, camZ, cx, cy, flip);
        const s2L = project(-pitchHalfWidth, y2, 0, camY, camZ, cx, cy, flip);
        const s2R = project(pitchHalfWidth, y2, 0, camY, camZ, cx, cy, flip);
        if (s1L && s1R && s2L && s2R) {
          ctx.fillStyle = "rgba(0, 0, 0, 0.035)";
          ctx.beginPath();
          ctx.moveTo(s1L.x, s1L.y);
          ctx.lineTo(s1R.x, s1R.y);
          ctx.lineTo(s2R.x, s2R.y);
          ctx.lineTo(s2L.x, s2L.y);
          ctx.closePath();
          ctx.fill();
        }
      }

      // Pitch boundary
      ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.stroke();
    }

    // =============================================
    // Crease lines
    // =============================================
    const creaseHalfW = pitchHalfWidth + 2; // extend beyond pitch

    // Bowling crease (CLOSE to camera → BIG)
    drawLine3D(ctx, -creaseHalfW, BOWLING_CREASE_Y, 0, creaseHalfW, BOWLING_CREASE_Y, 0,
      camY, camZ, cx, cy, flip, "rgba(255, 255, 255, 0.6)", 2.5);
    // Bowling return crease (behind bowling crease)
    drawLine3D(ctx, -creaseHalfW, -4, 0, creaseHalfW, -4, 0,
      camY, camZ, cx, cy, flip, "rgba(255, 255, 255, 0.25)", 1);
    // Batting crease (FAR from camera → small)
    drawLine3D(ctx, -creaseHalfW, BATTING_CREASE_Y, 0, creaseHalfW, BATTING_CREASE_Y, 0,
      camY, camZ, cx, cy, flip, "rgba(255, 255, 255, 0.5)", 1.5);
    // Batting return crease
    drawLine3D(ctx, -creaseHalfW, BATTING_CREASE_Y + 4, 0, creaseHalfW, BATTING_CREASE_Y + 4, 0,
      camY, camZ, cx, cy, flip, "rgba(255, 255, 255, 0.2)", 0.8);

    // =============================================
    // Bowling end stumps (CLOSE — LARGE)
    // =============================================
    drawStumps3D(ctx, BOWLING_CREASE_Y, camY, camZ, cx, cy, flip,
      "rgba(255, 255, 255, 0.75)", 3.5, 2.5);

    // =============================================
    // Batting end stumps (FAR — smaller)
    // =============================================
    drawStumps3D(ctx, BATTING_CREASE_Y, camY, camZ, cx, cy, flip,
      "rgba(255, 255, 255, 0.5)", 1.2, 0.8);

    // =============================================
    // Batsman silhouette (at batting crease)
    // =============================================
    const batWorld = normToWorld(0.55, 0.95); // slightly off centre
    const batScreen = project(batWorld.x, batWorld.y, 0, camY, camZ, cx, cy, flip);
    if (batScreen) {
      const bSize = Math.max(12, 60 * batScreen.scale);
      ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
      ctx.beginPath();
      ctx.ellipse(batScreen.x, batScreen.y, bSize * 0.7, bSize * 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();

      const fontSize = Math.max(7, bSize * 0.35);
      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.font = `bold ${fontSize}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.fillText("BATSMAN", batScreen.x, batScreen.y + bSize * 1.5);
    }

    // =============================================
    // Labels
    // =============================================
    const bowlLabel = project(0, -6, STUMP_HEIGHT * 0.5, camY, camZ, cx, cy, flip);
    if (bowlLabel) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.font = `bold ${Math.max(10, 18 * bowlLabel.scale)}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.fillText("BOWLING END", bowlLabel.x, bowlLabel.y);
    }
    const batLabel = project(0, BATTING_CREASE_Y + 6, STUMP_HEIGHT * 0.5, camY, camZ, cx, cy, flip);
    if (batLabel) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
      ctx.font = `bold ${Math.max(7, 12 * batLabel.scale)}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.fillText("BATSMAN END", batLabel.x, batLabel.y);
    }

    // =============================================
    // Ball trajectory
    // =============================================
    const { trajectory, frameData } = analysisResult;
    const isHitting = analysisResult.decision === "OUT";
    const totalPoints = frameData.length;

    if (totalPoints < 2) return;

    const visibleCount = Math.min(Math.floor(progress * totalPoints), totalPoints);

    // Map frameData to 3D world → screen
    const screenPoints: { x: number; y: number; scale: number }[] = [];
    for (let i = 0; i < visibleCount; i++) {
      const fd = frameData[i];
      const wp = normToWorld(fd.x, fd.y);
      // Ball height: estimate from progress (rises then falls)
      const t = i / Math.max(totalPoints - 1, 1);
      // Parabolic arc: peaks around t=0.3-0.4
      const ballZ = Math.max(0, 2.5 * 4 * t * (1 - t * 0.8));
      const sp = project(wp.x, wp.y, ballZ, camY, camZ, cx, cy, flip);
      if (sp) screenPoints.push(sp);
    }

    if (screenPoints.length < 2) {
      // Just show release point
      if (screenPoints.length === 1) {
        const p = screenPoints[0];
        const dotR = Math.max(4, 16 * p.scale);
        ctx.fillStyle = "#22d3ee";
        ctx.beginPath();
        ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `bold ${Math.max(9, 14 * p.scale)}px ui-monospace, monospace`;
        ctx.textAlign = "left";
        ctx.fillText("RELEASE", p.x + dotR + 4, p.y + 3);
      }
      return;
    }

    // --- Tracked path: outer glow ---
    ctx.save();
    ctx.strokeStyle = "rgba(251, 191, 36, 0.08)";
    ctx.lineWidth = 14;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
    for (let i = 1; i < screenPoints.length; i++) {
      ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();

    // --- Tracked path: inner glow ---
    ctx.save();
    ctx.strokeStyle = "rgba(251, 191, 36, 0.2)";
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
    for (let i = 1; i < screenPoints.length; i++) {
      ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();

    // --- Tracked path: main line ---
    ctx.strokeStyle = "rgba(251, 191, 36, 0.9)";
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
    for (let i = 1; i < screenPoints.length; i++) {
      ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
    }
    ctx.stroke();

    // --- Dots along path ---
    for (let i = 0; i < screenPoints.length; i++) {
      const pt = screenPoints[i];
      const t = i / (totalPoints - 1);
      let dotColor = "#f59e0b";
      if (t > 0.7) dotColor = isHitting ? "#ef4444" : "#3b82f6";
      const dotR = Math.max(1.5, 4 * pt.scale);
      ctx.fillStyle = dotColor;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // --- Release point ---
    const relPt = screenPoints[0];
    const relR = Math.max(4, 16 * relPt.scale);
    // Glow
    const relGlow = ctx.createRadialGradient(relPt.x, relPt.y, 0, relPt.x, relPt.y, relR * 3);
    relGlow.addColorStop(0, "rgba(34, 211, 238, 0.35)");
    relGlow.addColorStop(1, "transparent");
    ctx.fillStyle = relGlow;
    ctx.beginPath();
    ctx.arc(relPt.x, relPt.y, relR * 3, 0, Math.PI * 2);
    ctx.fill();
    // Dot
    ctx.fillStyle = "#22d3ee";
    ctx.beginPath();
    ctx.arc(relPt.x, relPt.y, relR, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `bold ${Math.max(9, 14 * relPt.scale)}px ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.fillText("RELEASE", relPt.x + relR + 6, relPt.y + 4);

    // =============================================
    // Predicted path (after ball reaches impact)
    // =============================================
    const impactProgress = 0.75;
    if (progress > impactProgress && trajectory.predictedPathPoints.length > 0) {
      const predProgress = Math.min(1.0, (progress - impactProgress) / (1.0 - impactProgress));
      const predVisibleCount = Math.floor(predProgress * trajectory.predictedPathPoints.length);
      const lastScreen = screenPoints[screenPoints.length - 1];

      const predScreenPoints: { x: number; y: number; scale: number }[] = [lastScreen];
      for (let i = 0; i < predVisibleCount; i++) {
        const pp = trajectory.predictedPathPoints[i];
        const wp = normToWorld(pp.x, pp.y);
        // Ball after impact: lower trajectory (pad height → stumps)
        const t = i / Math.max(trajectory.predictedPathPoints.length - 1, 1);
        const ballZ = Math.max(0, 1.8 * (1 - t * 1.2));
        const sp = project(wp.x, wp.y, ballZ, camY, camZ, cx, cy, flip);
        if (sp) predScreenPoints.push(sp);
      }

      if (predScreenPoints.length > 1) {
        // Glow
        ctx.save();
        ctx.strokeStyle = isHitting ? "rgba(239, 68, 68, 0.08)" : "rgba(59, 130, 246, 0.08)";
        ctx.lineWidth = 12;
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
        ctx.setLineDash([8, 5]);
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
          const dotR = Math.max(1.5, 3.5 * pt.scale);
          ctx.fillStyle = isHitting ? "rgba(239, 68, 68, 0.5)" : "rgba(59, 130, 246, 0.5)";
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, dotR, 0, Math.PI * 2);
          ctx.fill();
        }

        // End label
        const endPred = predScreenPoints[predScreenPoints.length - 1];
        const labelSize = Math.max(8, 12 * endPred.scale);
        ctx.fillStyle = isHitting ? "#ef4444" : "#3b82f6";
        ctx.font = `bold ${labelSize}px ui-monospace, monospace`;
        ctx.textAlign = "left";
        ctx.fillText(
          isHitting ? "HITTING STUMPS" : "MISSING STUMPS",
          endPred.x + 8, endPred.y + 4
        );

        // Impact label
        const impSize = Math.max(8, 12 * lastScreen.scale);
        ctx.fillStyle = "#fbbf24";
        ctx.font = `bold ${impSize}px ui-monospace, monospace`;
        ctx.fillText("IMPACT", lastScreen.x + 8, lastScreen.y - 10);
      }
    }

    // =============================================
    // Pitch point marker
    // =============================================
    if (trajectory.pitchPoint && progress > 0.3) {
      const wp = normToWorld(trajectory.pitchPoint.x, trajectory.pitchPoint.y);
      const pp = project(wp.x, wp.y, 0, camY, camZ, cx, cy, flip);
      if (pp) {
        const pr = Math.max(4, 12 * pp.scale);
        // Glow
        const pitchGlow = ctx.createRadialGradient(pp.x, pp.y, 0, pp.x, pp.y, pr * 3);
        pitchGlow.addColorStop(0, "rgba(16, 185, 129, 0.4)");
        pitchGlow.addColorStop(1, "transparent");
        ctx.fillStyle = pitchGlow;
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, pr * 3, 0, Math.PI * 2);
        ctx.fill();
        // Dot
        ctx.fillStyle = "#10b981";
        ctx.beginPath();
        ctx.arc(pp.x, pp.y, pr, 0, Math.PI * 2);
        ctx.fill();
        // Crosshair
        ctx.strokeStyle = "#10b981";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pp.x - pr * 1.5, pp.y); ctx.lineTo(pp.x + pr * 1.5, pp.y);
        ctx.moveTo(pp.x, pp.y - pr * 1.5); ctx.lineTo(pp.x, pp.y + pr * 1.5);
        ctx.stroke();
        // Label
        const pLabelSize = Math.max(8, 11 * pp.scale);
        ctx.font = `bold ${pLabelSize}px ui-monospace, monospace`;
        ctx.textAlign = "left";
        ctx.fillText("PITCH", pp.x + pr * 2, pp.y - pr);
      }
    }

    // =============================================
    // Current ball position (animated)
    // =============================================
    if (visibleCount > 0 && visibleCount < totalPoints && screenPoints.length > 0) {
      const curr = screenPoints[screenPoints.length - 1];
      const t = visibleCount / (totalPoints - 1);
      let ballColor = "#f59e0b";
      if (t >= 0.7) ballColor = isHitting ? "#ef4444" : "#3b82f6";

      const ballR = Math.max(5, 18 * curr.scale);
      // Large glow
      const largeGlow = ctx.createRadialGradient(curr.x, curr.y, 0, curr.x, curr.y, ballR * 4);
      largeGlow.addColorStop(0, ballColor + "60");
      largeGlow.addColorStop(0.5, ballColor + "20");
      largeGlow.addColorStop(1, "transparent");
      ctx.fillStyle = largeGlow;
      ctx.beginPath();
      ctx.arc(curr.x, curr.y, ballR * 4, 0, Math.PI * 2);
      ctx.fill();
      // Ball body
      ctx.fillStyle = ballColor;
      ctx.beginPath();
      ctx.arc(curr.x, curr.y, ballR, 0, Math.PI * 2);
      ctx.fill();
      // Highlight
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath();
      ctx.arc(curr.x - ballR * 0.3, curr.y - ballR * 0.3, ballR * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }

    // =============================================
    // Stump hit zone highlight (when predicted to hit)
    // =============================================
    if (isHitting && progress > 0.9) {
      const alpha = Math.min(1, (progress - 0.9) / 0.1) * 0.2;
      const s1 = project(-STUMP_SPREAD - 0.3, BATTING_CREASE_Y, 0, camY, camZ, cx, cy, flip);
      const s2 = project(STUMP_SPREAD + 0.3, BATTING_CREASE_Y, STUMP_HEIGHT, camY, camZ, cx, cy, flip);
      if (s1 && s2) {
        ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
        ctx.fillRect(s2.x, s2.y, s1.x - s2.x, s1.y - s2.y);
        ctx.strokeStyle = `rgba(239, 68, 68, ${alpha * 2})`;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(s2.x, s2.y, s1.x - s2.x, s1.y - s2.y);
      }
    }

    // =============================================
    // Ball speed indicator
    // =============================================
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.font = `${Math.max(9, w * 0.02)}px ui-monospace, monospace`;
    ctx.textAlign = "right";
    ctx.fillText(`${trajectory.ballSpeed} km/h`, w - 15, 22);

    // =============================================
    // Legend
    // =============================================
    const legendY = h - 12;
    ctx.font = `${Math.max(7, w * 0.015)}px ui-monospace, monospace`;
    ctx.textAlign = "left";

    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(12, legendY - 4, 10, 2.5);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText("Tracked", 26, legendY);

    ctx.setLineDash([3, 2]);
    ctx.strokeStyle = isHitting ? "#ef4444" : "#3b82f6";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(90, legendY - 3);
    ctx.lineTo(110, legendY - 3);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText("Predicted", 114, legendY);

    ctx.fillStyle = "#22d3ee";
    ctx.beginPath();
    ctx.arc(190, legendY - 3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText("Release", 197, legendY);

    ctx.fillStyle = "#10b981";
    ctx.beginPath();
    ctx.arc(252, legendY - 3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillText("Pitch", 259, legendY);

    // =============================================
    // "UMPIRE PERSPECTIVE" label
    // =============================================
    ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
    ctx.font = `${Math.max(8, w * 0.016)}px ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.fillText("UMPIRE PERSPECTIVE  ·  6ft  ·  4ft BEHIND CREASE", 12, 20);

  }, [analysisResult, normToWorld]);

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

      if (isPlayingRef.current) {
        const increment = (deltaMs / 3500) * playbackSpeedRef.current;
        progressRef.current = Math.min(1.0, progressRef.current + increment);
        onProgress?.(progressRef.current);
      }

      drawScene(progressRef.current, w, h);

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

  // Reset on new result
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
