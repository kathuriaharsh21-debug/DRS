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
 * Authentic Hawk-Eye DRS 3D cricket pitch ball tracking visualisation.
 *
 * Faithfully recreates the broadcast overlay used in international cricket:
 *
 *   - Camera positioned ELEVATED 32° from behind/above bowler's end,
 *     12° azimuth offset — the classic Hawk-Eye isometric view.
 *   - Pitch rendered as natural BROWN/TAN surface (#B8A060) with subtle
 *     mowed grass stripe texture — NOT green (real cricket pitch colour).
 *   - Dark green-black broadcast background (#0a1a0a → #1a2e1a).
 *   - Tracked ball path: SOLID bright orange-yellow (#FBBF24) with bloom/glow.
 *   - Predicted path (hitting): DASHED RED (#FF0000) with glow.
 *   - Predicted path (missing): DASHED BLUE (#3B82F6) with glow.
 *   - Ball: Red cricket ball (#CC0000) with white specular highlight.
 *   - Stumps: Off-white/cream at BROADCAST SCALE (~15-20% frame height).
 *   - Stumps glow RED/ORANGE when ball is predicted to hit.
 *   - "HAWK-EYE" watermark bottom-left, ball speed top-right.
 *   - Full 6-second animation sequence matching broadcast pacing.
 */

// ═══════════════════════════════════════════════════════════
// PHYSICAL PITCH CONSTANTS (feet)
// ═══════════════════════════════════════════════════════════
const PITCH_LENGTH = 66.0;     // 22 yards
const PITCH_WIDTH = 10.0;      // official pitch width
const STUMP_HEIGHT = 2.333;    // 28 inches in feet
const STUMP_SPREAD = 0.75;     // half-width between off & leg stump (9")
const STUMP_THICKNESS = 0.18;  // visual stump width (slightly thicker for broadcast)
const BAIL_LENGTH = 0.5;       // bail extends past stump tops
const POPPING_CREASE_DIST = 4; // 4 feet in front of bowling crease

// ═══════════════════════════════════════════════════════════
// CAMERA CONSTANTS — Hawk-Eye broadcast angles
// ═══════════════════════════════════════════════════════════
const CAM_ELEVATION = 32;      // degrees above horizontal
const CAM_AZIMUTH = 12;        // degrees from center axis (slight offset)
const CAM_DISTANCE = 85;       // distance from pitch centre (feet)
const CAM_HEIGHT_FEET = 35;    // ~10.7m above ground (broadcast crane)

// ═══════════════════════════════════════════════════════════
// PROJECTION
// ═══════════════════════════════════════════════════════════
const FOCAL_LENGTH = 450;      // focal length in pixels (broadcast telephoto look)

// Animation timing (at 1x speed, total ~6 seconds)
const ANIM_DURATION_MS = 6000;
// Phase boundaries (progress 0-1)
const PHASE_SETUP = 0.05;        // 0-0.05: pitch fades in
const PHASE_RELEASE = 0.12;      // 0.05-0.12: release point appears
const PHASE_FLIGHT = 0.50;       // 0.12-0.50: ball in flight, tracked path
const PHASE_PITCH_BOUNCE = 0.55; // 0.50-0.55: pitch bounce marker
const PHASE_TO_IMPACT = 0.70;    // 0.55-0.70: post-pitch to impact
const PHASE_PREDICTED = 0.88;    // 0.70-0.88: predicted path reveal
const PHASE_STUMPS = 0.95;       // 0.88-0.95: stumps decision glow
const PHASE_SUMMARY = 1.0;       // 0.95-1.0: full summary with labels

/** Convert feet to world 3D coordinates relative to pitch centre. */
function worldFromPitch(
  pitchX: number,  // lateral: 0 = centre, + = off side, - = leg side
  pitchY: number,  // along pitch: 0 = bowling crease, 66 = batting crease
  pitchZ: number,  // height above ground (feet)
): { x: number; y: number; z: number } {
  return { x: pitchX, y: pitchY - PITCH_LENGTH / 2, z: pitchZ };
}

/** Project world 3D point to canvas 2D using elevated Hawk-Eye camera. */
function project(
  wx: number, wy: number, wz: number,
  cx: number, cy: number, flip: number,
  canvasW: number, canvasH: number,
): { x: number; y: number; scale: number } | null {
  const elevRad = (CAM_ELEVATION * Math.PI) / 180;
  const azRad = (CAM_AZIMUTH * Math.PI) / 180;

  // Camera position: elevated, slightly to the side, looking along pitch axis
  const camX = CAM_DISTANCE * Math.sin(azRad);
  const camY = -CAM_DISTANCE * Math.cos(azRad);
  const camZ = CAM_HEIGHT_FEET;

  // Look-at point: slightly past pitch centre toward batting end
  const lookX = 0;
  const lookY = 5;
  const lookZ = 0;

  // Camera coordinate system
  const forward = {
    x: lookX - camX, y: lookY - camY, z: lookZ - camZ
  };
  const fLen = Math.sqrt(forward.x ** 2 + forward.y ** 2 + forward.z ** 2);
  const fwd = { x: forward.x / fLen, y: forward.y / fLen, z: forward.z / fLen };

  const worldUp = { x: 0, y: 0, z: 1 };

  let right = {
    x: fwd.y * worldUp.z - fwd.z * worldUp.y,
    y: fwd.z * worldUp.x - fwd.x * worldUp.z,
    z: fwd.x * worldUp.y - fwd.y * worldUp.x,
  };
  const rLen = Math.sqrt(right.x ** 2 + right.y ** 2 + right.z ** 2);
  right = { x: right.x / rLen, y: right.y / rLen, z: right.z / rLen };

  const up = {
    x: right.y * fwd.z - right.z * fwd.y,
    y: right.z * fwd.x - right.x * fwd.z,
    z: right.x * fwd.y - right.y * fwd.x,
  };

  const dx = wx - camX;
  const dy = wy - camY;
  const dz = wz - camZ;

  const camSpaceX = dx * right.x + dy * right.y + dz * right.z;
  const camSpaceY = dx * up.x + dy * up.y + dz * up.z;
  const camSpaceZ = dx * fwd.x + dy * fwd.y + dz * fwd.z;

  if (camSpaceZ <= 0.5) return null;

  const sx = cx + flip * (FOCAL_LENGTH * camSpaceX) / camSpaceZ;
  const sy = cy - (FOCAL_LENGTH * camSpaceY) / camSpaceZ;
  const scale = FOCAL_LENGTH / camSpaceZ;

  return { x: sx, y: sy, scale };
}

/** Draw a 3D line between two world-coordinate points. */
function drawLine3D(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  cx: number, cy: number, flip: number,
  cw: number, ch: number,
  style: string, width: number = 1, dash: number[] = [],
) {
  const w1 = worldFromPitch(x1, y1, z1);
  const w2 = worldFromPitch(x2, y2, z2);
  const a = project(w1.x, w1.y, w1.z, cx, cy, flip, cw, ch);
  const b = project(w2.x, w2.y, w2.z, cx, cy, flip, cw, ch);
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

/** Draw a complete set of stumps at BROADCAST SCALE — clearly visible. */
function drawStumpSet(
  ctx: CanvasRenderingContext2D,
  pitchY: number,
  cx: number, cy: number, flip: number,
  cw: number, ch: number,
  color: string, highlight: boolean = false,
  alpha: number = 1.0,
) {
  const positions = [-STUMP_SPREAD, 0, STUMP_SPREAD];
  const ground = 0;
  const top = STUMP_HEIGHT;

  // Stump colour — cream when neutral, red when highlighted
  const stumpColor = highlight ? "#FF4400" : color;
  const stumpAlpha = highlight ? 1.0 : alpha;

  // Stumps get a broadcast-scale thickness multiplier
  const stumpscaleMult = 1.8;

  // Draw each stump
  for (const sx of positions) {
    const wBot = worldFromPitch(sx, pitchY, ground);
    const wTop = worldFromPitch(sx, pitchY, top);
    const bot = project(wBot.x, wBot.y, wBot.z, cx, cy, flip, cw, ch);
    const tp = project(wTop.x, wTop.y, wTop.z, cx, cy, flip, cw, ch);
    if (!bot || !tp) continue;

    const lineW = Math.max(3, 8 * bot.scale * stumpscaleMult);

    // Glow behind stump (for hit highlight)
    if (highlight) {
      // Outer glow
      ctx.save();
      ctx.strokeStyle = "rgba(255, 51, 0, 0.25)";
      ctx.lineWidth = lineW * 6;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(bot.x, bot.y);
      ctx.lineTo(tp.x, tp.y);
      ctx.stroke();
      ctx.restore();

      // Middle glow
      ctx.save();
      ctx.strokeStyle = "rgba(255, 102, 0, 0.4)";
      ctx.lineWidth = lineW * 3;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(bot.x, bot.y);
      ctx.lineTo(tp.x, tp.y);
      ctx.stroke();
      ctx.restore();
    }

    // Main stump body — cream/off-white
    ctx.save();
    ctx.globalAlpha = stumpAlpha;
    ctx.strokeStyle = stumpColor;
    ctx.lineWidth = lineW;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(bot.x, bot.y);
    ctx.lineTo(tp.x, tp.y);
    ctx.stroke();

    // Stump highlight edge (lighter side)
    ctx.strokeStyle = highlight
      ? "rgba(255, 170, 100, 0.6)"
      : "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = lineW * 0.4;
    ctx.beginPath();
    ctx.moveTo(bot.x - lineW * 0.15, bot.y);
    ctx.lineTo(tp.x - lineW * 0.15, tp.y);
    ctx.stroke();
    ctx.restore();
  }

  // Draw bails
  for (let i = 0; i < 2; i++) {
    const sx1 = positions[i];
    const sx2 = positions[i + 1];
    const ext = BAIL_LENGTH * 0.35;
    const w1 = worldFromPitch(sx1 - ext, pitchY, top);
    const w2 = worldFromPitch(sx2 + ext, pitchY, top);
    const p1 = project(w1.x, w1.y, w1.z, cx, cy, flip, cw, ch);
    const p2 = project(w2.x, w2.y, w2.z, cx, cy, flip, cw, ch);
    if (!p1 || !p2) continue;

    const bailW = Math.max(2, 5 * p1.scale * stumpscaleMult);

    ctx.save();
    ctx.globalAlpha = stumpAlpha;
    ctx.strokeStyle = stumpColor;
    ctx.lineWidth = bailW;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();

    // Bail highlight
    ctx.strokeStyle = highlight
      ? "rgba(255, 170, 100, 0.5)"
      : "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = bailW * 0.35;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y - bailW * 0.2);
    ctx.lineTo(p2.x, p2.y - bailW * 0.2);
    ctx.stroke();
    ctx.restore();
  }
}

/** Draw the pitch surface as a filled perspective quad — BROWN/TAN. */
function drawPitchSurface(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, flip: number,
  cw: number, ch: number,
  fadeAlpha: number = 1.0,
) {
  const hw = PITCH_WIDTH / 2;
  const corners3D = [
    worldFromPitch(-hw, 0, 0),
    worldFromPitch(hw, 0, 0),
    worldFromPitch(hw, PITCH_LENGTH, 0),
    worldFromPitch(-hw, PITCH_LENGTH, 0),
  ];

  const corners = corners3D.map(c =>
    project(c.x, c.y, c.z, cx, cy, flip, cw, ch)
  );

  if (!corners.every(Boolean)) return;
  const pts = corners.filter(Boolean) as { x: number; y: number; scale: number }[];

  ctx.save();
  ctx.globalAlpha = fadeAlpha;

  // ─── Pitch fill — BROWN/TAN (real cricket pitch colour) ───
  const pitchGrad = ctx.createLinearGradient(cx, pts[0].y, cx, pts[3].y);
  pitchGrad.addColorStop(0, "#C8B070");
  pitchGrad.addColorStop(0.12, "#B8A060");
  pitchGrad.addColorStop(0.30, "#BDA868");
  pitchGrad.addColorStop(0.50, "#B8A060");
  pitchGrad.addColorStop(0.70, "#BDA868");
  pitchGrad.addColorStop(0.88, "#B8A060");
  pitchGrad.addColorStop(1, "#C8B070");

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = pitchGrad;
  ctx.fill();

  // ─── Subtle mowed grass stripes (alternating lighter/darker strips) ───
  const stripeCount = 20;
  for (let i = 0; i < stripeCount; i++) {
    const y1 = (i / stripeCount) * PITCH_LENGTH;
    const y2 = ((i + 1) / stripeCount) * PITCH_LENGTH;

    const s1L = worldFromPitch(-hw, y1, 0);
    const s1R = worldFromPitch(hw, y1, 0);
    const s2L = worldFromPitch(-hw, y2, 0);
    const s2R = worldFromPitch(hw, y2, 0);

    const p1L = project(s1L.x, s1L.y, s1L.z, cx, cy, flip, cw, ch);
    const p1R = project(s1R.x, s1R.y, s1R.z, cx, cy, flip, cw, ch);
    const p2L = project(s2L.x, s2L.y, s2L.z, cx, cy, flip, cw, ch);
    const p2R = project(s2R.x, s2R.y, s2R.z, cx, cy, flip, cw, ch);

    if (p1L && p1R && p2L && p2R) {
      // Alternating subtle dark/light stripes on the brown surface
      ctx.fillStyle = i % 2 === 0
        ? "rgba(0, 0, 0, 0.035)"
        : "rgba(255, 255, 255, 0.025)";
      ctx.beginPath();
      ctx.moveTo(p1L.x, p1L.y);
      ctx.lineTo(p1R.x, p1R.y);
      ctx.lineTo(p2R.x, p2R.y);
      ctx.lineTo(p2L.x, p2L.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ─── Pitch outline ───
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();

  ctx.restore();
}

/** Draw a red cricket ball with specular highlight — 3D look. */
function drawCricketBall(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, radius: number,
) {
  // Outer glow
  const outerGlow = ctx.createRadialGradient(x, y, 0, x, y, radius * 3.5);
  outerGlow.addColorStop(0, "rgba(204, 0, 0, 0.35)");
  outerGlow.addColorStop(0.3, "rgba(204, 0, 0, 0.15)");
  outerGlow.addColorStop(1, "transparent");
  ctx.fillStyle = outerGlow;
  ctx.beginPath();
  ctx.arc(x, y, radius * 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Ball body — dark red gradient
  const ballGrad = ctx.createRadialGradient(
    x - radius * 0.3, y - radius * 0.3, radius * 0.1,
    x, y, radius
  );
  ballGrad.addColorStop(0, "#E03030");
  ballGrad.addColorStop(0.35, "#CC0000");
  ballGrad.addColorStop(0.7, "#990000");
  ballGrad.addColorStop(1, "#6B0000");
  ctx.fillStyle = ballGrad;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  // Seam line (subtle curved line)
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = Math.max(0.5, radius * 0.08);
  ctx.beginPath();
  ctx.ellipse(x, y, radius * 0.85, radius * 0.3, -0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Primary specular highlight (white)
  const hlGrad = ctx.createRadialGradient(
    x - radius * 0.35, y - radius * 0.35, 0,
    x - radius * 0.35, y - radius * 0.35, radius * 0.55
  );
  hlGrad.addColorStop(0, "rgba(255, 255, 255, 0.75)");
  hlGrad.addColorStop(0.5, "rgba(255, 255, 255, 0.2)");
  hlGrad.addColorStop(1, "transparent");
  ctx.fillStyle = hlGrad;
  ctx.beginPath();
  ctx.arc(x - radius * 0.35, y - radius * 0.35, radius * 0.55, 0, Math.PI * 2);
  ctx.fill();

  // Secondary highlight
  ctx.fillStyle = "rgba(255, 200, 200, 0.15)";
  ctx.beginPath();
  ctx.arc(x + radius * 0.2, y + radius * 0.25, radius * 0.3, 0, Math.PI * 2);
  ctx.fill();
}

/** Easing function for smooth animation. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
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
   * Map normalised frame coordinate (0-1) to pitch world coordinates.
   *   x: 0=left (leg), 0.5=centre, 1=right (off)
   *   y: 0=bowling end, 1=batting end
   */
  const normToPitch = useCallback((nx: number, ny: number, t: number = 0) => {
    const pitchX = (nx - 0.5) * 6;
    const pitchY = ny * PITCH_LENGTH;
    // Parabolic arc: ball released at ~7ft, peaks early, drops to pitch
    const maxHeight = 7.0;
    const pitchZ = Math.max(0, maxHeight * 4 * t * (1 - t * 0.7));
    return { pitchX, pitchY, pitchZ };
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

    const cx = w * 0.5;
    const cy = h * 0.48; // slightly above centre for better composition
    const flip = -1; // bowling end at top

    const { trajectory, frameData } = analysisResult;
    const isHitting = trajectory.predictedPath === "HITTING";
    const totalPoints = frameData.length;

    // ═══════════════════════════════════════════════════════
    // BACKGROUND — dark green-black (broadcast DRS overlay)
    // ═══════════════════════════════════════════════════════
    const bgGrad = ctx.createRadialGradient(cx, cy * 0.9, 0, cx, cy, w * 0.75);
    bgGrad.addColorStop(0, "#1a2e1a");
    bgGrad.addColorStop(0.4, "#122012");
    bgGrad.addColorStop(0.7, "#0e1a0e");
    bgGrad.addColorStop(1, "#0a1a0a");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle outfield green around pitch
    const groundGrad = ctx.createRadialGradient(cx, cy, w * 0.05, cx, cy, w * 0.45);
    groundGrad.addColorStop(0, "rgba(20, 60, 25, 0.4)");
    groundGrad.addColorStop(0.5, "rgba(15, 45, 18, 0.25)");
    groundGrad.addColorStop(1, "transparent");
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, 0, w, h);

    // ═══════════════════════════════════════════════════════
    // PHASE: SETUP — pitch fade-in
    // ═══════════════════════════════════════════════════════
    const setupAlpha = progress < PHASE_SETUP
      ? easeOutCubic(progress / PHASE_SETUP)
      : 1.0;

    // ═══════════════════════════════════════════════════════
    // PITCH SURFACE — BROWN/TAN
    // ═══════════════════════════════════════════════════════
    drawPitchSurface(ctx, cx, cy, flip, w, h, setupAlpha);

    // ═══════════════════════════════════════════════════════
    // CREASE LINES
    // ═══════════════════════════════════════════════════════
    ctx.save();
    ctx.globalAlpha = setupAlpha;
    const creaseHW = PITCH_WIDTH / 2 + 3;

    // Bowling crease — white, prominent
    drawLine3D(ctx, -creaseHW, 0, 0, creaseHW, 0, 0, cx, cy, flip, w, h,
      "rgba(255, 255, 255, 0.75)", 2);

    // Bowling popping crease — 4ft in front
    drawLine3D(ctx, -creaseHW, POPPING_CREASE_DIST, 0, creaseHW, POPPING_CREASE_DIST, 0, cx, cy, flip, w, h,
      "rgba(255, 255, 255, 0.5)", 1.5);

    // Bowling return creases
    drawLine3D(ctx, -creaseHW, -4, 0, -creaseHW, POPPING_CREASE_DIST, 0, cx, cy, flip, w, h,
      "rgba(255, 255, 255, 0.3)", 1.2);
    drawLine3D(ctx, creaseHW, -4, 0, creaseHW, POPPING_CREASE_DIST, 0, cx, cy, flip, w, h,
      "rgba(255, 255, 255, 0.3)", 1.2);

    // Batting crease — white
    drawLine3D(ctx, -creaseHW, PITCH_LENGTH, 0, creaseHW, PITCH_LENGTH, 0, cx, cy, flip, w, h,
      "rgba(255, 255, 255, 0.65)", 2);

    // Batting popping crease — 4ft in front of batting crease
    drawLine3D(ctx, -creaseHW, PITCH_LENGTH - POPPING_CREASE_DIST, 0, creaseHW, PITCH_LENGTH - POPPING_CREASE_DIST, 0, cx, cy, flip, w, h,
      "rgba(255, 255, 255, 0.45)", 1.5);

    // Batting return creases
    drawLine3D(ctx, -creaseHW, PITCH_LENGTH, 0, -creaseHW, PITCH_LENGTH + 4, 0, cx, cy, flip, w, h,
      "rgba(255, 255, 255, 0.25)", 1.2);
    drawLine3D(ctx, creaseHW, PITCH_LENGTH, 0, creaseHW, PITCH_LENGTH + 4, 0, cx, cy, flip, w, h,
      "rgba(255, 255, 255, 0.25)", 1.2);

    ctx.restore();

    // ═══════════════════════════════════════════════════════
    // BOWLING END STUMPS (always visible, behind ball path)
    // ═══════════════════════════════════════════════════════
    ctx.save();
    ctx.globalAlpha = setupAlpha;
    drawStumpSet(ctx, 0, cx, cy, flip, w, h, "#F0E8D8", false, 0.9);
    ctx.restore();

    // ═══════════════════════════════════════════════════════
    // BATTING END STUMPS (highlight when hitting)
    // ═══════════════════════════════════════════════════════
    const stumpsHighlightAlpha = progress > PHASE_STUMPS && isHitting
      ? Math.min(1, (progress - PHASE_STUMPS) / (PHASE_SUMMARY - PHASE_STUMPS))
      : 0;
    ctx.save();
    ctx.globalAlpha = setupAlpha;
    drawStumpSet(
      ctx, PITCH_LENGTH, cx, cy, flip, w, h,
      "#F0E8D8",
      stumpsHighlightAlpha > 0,
      0.85,
    );
    ctx.restore();

    // ═══════════════════════════════════════════════════════
    // STUMP HIT ZONE (translucent rectangle at batting stumps)
    // ═══════════════════════════════════════════════════════
    if (isHitting && progress > PHASE_PREDICTED) {
      const alpha = Math.min(0.3, (progress - PHASE_PREDICTED) / (PHASE_STUMPS - PHASE_PREDICTED) * 0.3);
      const zoneBL = worldFromPitch(-STUMP_SPREAD - 0.35, PITCH_LENGTH - 0.35, 0);
      const zoneBR = worldFromPitch(STUMP_SPREAD + 0.35, PITCH_LENGTH - 0.35, 0);
      const zoneTL = worldFromPitch(-STUMP_SPREAD - 0.35, PITCH_LENGTH + 0.35, STUMP_HEIGHT);
      const zoneTR = worldFromPitch(STUMP_SPREAD + 0.35, PITCH_LENGTH + 0.35, STUMP_HEIGHT);

      const pBL = project(zoneBL.x, zoneBL.y, zoneBL.z, cx, cy, flip, w, h);
      const pBR = project(zoneBR.x, zoneBR.y, zoneBR.z, cx, cy, flip, w, h);
      const pTL = project(zoneTL.x, zoneTL.y, zoneTL.z, cx, cy, flip, w, h);
      const pTR = project(zoneTR.x, zoneTR.y, zoneTR.z, cx, cy, flip, w, h);

      if (pBL && pBR && pTL && pTR) {
        ctx.fillStyle = `rgba(255, 51, 0, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(pBL.x, pBL.y);
        ctx.lineTo(pBR.x, pBR.y);
        ctx.lineTo(pTR.x, pTR.y);
        ctx.lineTo(pTL.x, pTL.y);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = `rgba(255, 102, 0, ${alpha * 2})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // ═══════════════════════════════════════════════════════
    // END LABELS — Bowling End / Batsman End
    // ═══════════════════════════════════════════════════════
    const bowlLabelWorld = worldFromPitch(0, -6, STUMP_HEIGHT * 0.5);
    const bowlLabel = project(bowlLabelWorld.x, bowlLabelWorld.y, bowlLabelWorld.z, cx, cy, flip, w, h);
    if (bowlLabel && setupAlpha > 0.3) {
      const fs = Math.max(8, 13 * bowlLabel.scale);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.3 * setupAlpha})`;
      ctx.font = `bold ${fs}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.fillText("BOWLING END", bowlLabel.x, bowlLabel.y);
    }

    const batLabelWorld = worldFromPitch(0, PITCH_LENGTH + 6, STUMP_HEIGHT * 0.5);
    const batLabel = project(batLabelWorld.x, batLabelWorld.y, batLabelWorld.z, cx, cy, flip, w, h);
    if (batLabel && setupAlpha > 0.3) {
      const fs = Math.max(7, 11 * batLabel.scale);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.25 * setupAlpha})`;
      ctx.font = `bold ${fs}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.fillText("BATSMAN END", batLabel.x, batLabel.y);
    }

    // ═══════════════════════════════════════════════════════
    // BALL TRAJECTORY — tracked path
    // ═══════════════════════════════════════════════════════
    if (totalPoints < 2) return;

    // Calculate how many points are visible based on progress
    // Map animation phases to trajectory point visibility
    let trajectoryProgress: number;
    if (progress <= PHASE_RELEASE) {
      trajectoryProgress = 0;
    } else if (progress <= PHASE_TO_IMPACT) {
      // Map [PHASE_RELEASE, PHASE_TO_IMPACT] → [0, 1]
      trajectoryProgress = easeInOutQuad(
        (progress - PHASE_RELEASE) / (PHASE_TO_IMPACT - PHASE_RELEASE)
      );
    } else {
      trajectoryProgress = 1.0;
    }

    const visibleCount = Math.min(
      Math.floor(trajectoryProgress * totalPoints),
      totalPoints
    );

    // Project all visible trajectory points
    const screenPoints: { x: number; y: number; scale: number; pitchZ: number }[] = [];
    for (let i = 0; i < visibleCount; i++) {
      const fd = frameData[i];
      const t = i / Math.max(totalPoints - 1, 1);
      const pitch = normToPitch(fd.x, fd.y, t);
      const world = worldFromPitch(pitch.pitchX, pitch.pitchY, pitch.pitchZ);
      const sp = project(world.x, world.y, world.z, cx, cy, flip, w, h);
      if (sp) screenPoints.push({ ...sp, pitchZ: pitch.pitchZ });
    }

    // Release point (always shown after setup)
    if (progress > PHASE_RELEASE && screenPoints.length > 0) {
      const relPt = screenPoints[0];
      const releaseAlpha = Math.min(1, (progress - PHASE_RELEASE) / 0.05);
      const relR = Math.max(4, 13 * relPt.scale);

      ctx.save();
      ctx.globalAlpha = releaseAlpha;

      // Glow
      const relGlow = ctx.createRadialGradient(relPt.x, relPt.y, 0, relPt.x, relPt.y, relR * 3);
      relGlow.addColorStop(0, "rgba(34, 211, 238, 0.4)");
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

      // Label
      ctx.fillStyle = "#22d3ee";
      ctx.font = `bold ${Math.max(8, 11 * relPt.scale)}px ui-monospace, monospace`;
      ctx.textAlign = "left";
      ctx.fillText("RELEASE", relPt.x + relR + 5, relPt.y + 3);

      ctx.restore();
    }

    // ─── TRACKED PATH rendering ───
    if (screenPoints.length >= 2) {
      // Outer glow (bloom effect)
      ctx.save();
      ctx.strokeStyle = "rgba(251, 191, 36, 0.08)";
      ctx.lineWidth = 20;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
      for (let i = 1; i < screenPoints.length; i++) {
        ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
      }
      ctx.stroke();
      ctx.restore();

      // Middle glow
      ctx.save();
      ctx.strokeStyle = "rgba(251, 191, 36, 0.2)";
      ctx.lineWidth = 10;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
      for (let i = 1; i < screenPoints.length; i++) {
        ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
      }
      ctx.stroke();
      ctx.restore();

      // Inner glow
      ctx.save();
      ctx.strokeStyle = "rgba(251, 191, 36, 0.4)";
      ctx.lineWidth = 5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
      for (let i = 1; i < screenPoints.length; i++) {
        ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
      }
      ctx.stroke();
      ctx.restore();

      // Main solid orange/yellow line
      ctx.strokeStyle = "rgba(251, 191, 36, 0.95)";
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
      for (let i = 1; i < screenPoints.length; i++) {
        ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
      }
      ctx.stroke();

      // Core bright line
      ctx.strokeStyle = "rgba(255, 230, 150, 0.6)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
      for (let i = 1; i < screenPoints.length; i++) {
        ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
      }
      ctx.stroke();
    }

    // ═══════════════════════════════════════════════════════
    // PITCH POINT marker
    // ═══════════════════════════════════════════════════════
    if (trajectory.pitchPoint && progress > PHASE_PITCH_BOUNCE) {
      const pitchAlpha = Math.min(1, (progress - PHASE_PITCH_BOUNCE) / 0.05);
      const pp = trajectory.pitchPoint;
      const pitchX = (pp.x - 0.5) * 6;
      const pitchY = pp.y * PITCH_LENGTH;
      const world = worldFromPitch(pitchX, pitchY, 0);
      const sp = project(world.x, world.y, world.z, cx, cy, flip, w, h);
      if (sp) {
        const pr = Math.max(4, 11 * sp.scale);

        ctx.save();
        ctx.globalAlpha = pitchAlpha;

        // Glow
        const pitchGlow = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, pr * 3.5);
        pitchGlow.addColorStop(0, "rgba(16, 185, 129, 0.5)");
        pitchGlow.addColorStop(0.5, "rgba(16, 185, 129, 0.15)");
        pitchGlow.addColorStop(1, "transparent");
        ctx.fillStyle = pitchGlow;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, pr * 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Circle
        ctx.fillStyle = "#10B981";
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, pr, 0, Math.PI * 2);
        ctx.fill();

        // Crosshair
        ctx.strokeStyle = "#10B981";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sp.x - pr * 2, sp.y);
        ctx.lineTo(sp.x + pr * 2, sp.y);
        ctx.moveTo(sp.x, sp.y - pr * 2);
        ctx.lineTo(sp.x, sp.y + pr * 2);
        ctx.stroke();

        // Label
        ctx.font = `bold ${Math.max(8, 10 * sp.scale)}px ui-monospace, monospace`;
        ctx.textAlign = "left";
        ctx.fillStyle = "#10B981";
        ctx.fillText("PITCH", sp.x + pr * 2.5, sp.y - pr);

        ctx.restore();
      }
    }

    // ═══════════════════════════════════════════════════════
    // PREDICTED PATH (after impact — dashed RED/BLUE)
    // ═══════════════════════════════════════════════════════
    if (progress > PHASE_TO_IMPACT && trajectory.predictedPathPoints.length > 0) {
      const predProgress = easeOutCubic(
        Math.min(1, (progress - PHASE_TO_IMPACT) / (PHASE_STUMPS - PHASE_TO_IMPACT))
      );
      const predVisibleCount = Math.floor(predProgress * trajectory.predictedPathPoints.length);
      const lastScreen = screenPoints.length > 0 ? screenPoints[screenPoints.length - 1] : null;

      if (lastScreen) {
        const predScreenPoints: { x: number; y: number; scale: number }[] = [lastScreen];
        for (let i = 0; i < predVisibleCount; i++) {
          const pp = trajectory.predictedPathPoints[i];
          const t = i / Math.max(trajectory.predictedPathPoints.length - 1, 1);
          // Ball drops from pad height toward stumps
          const pitchZ = Math.max(0, 2.5 * (1 - t * 1.3));
          const pitchX = (pp.x - 0.5) * 6;
          const pitchY = pp.y * PITCH_LENGTH;
          const world = worldFromPitch(pitchX, pitchY, pitchZ);
          const sp = project(world.x, world.y, world.z, cx, cy, flip, w, h);
          if (sp) predScreenPoints.push(sp);
        }

        if (predScreenPoints.length > 1) {
          const predColor = isHitting ? "#FF0000" : "#3B82F6";
          const predGlowColor = isHitting ? "rgba(255, 0, 0," : "rgba(59, 130, 246,";

          // Outer glow
          ctx.save();
          ctx.strokeStyle = predGlowColor + "0.08)";
          ctx.lineWidth = 18;
          ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(predScreenPoints[0].x, predScreenPoints[0].y);
          for (let i = 1; i < predScreenPoints.length; i++) {
            ctx.lineTo(predScreenPoints[i].x, predScreenPoints[i].y);
          }
          ctx.stroke();
          ctx.restore();

          // Middle glow
          ctx.save();
          ctx.strokeStyle = predGlowColor + "0.2)";
          ctx.lineWidth = 8;
          ctx.lineJoin = "round";
          ctx.beginPath();
          ctx.moveTo(predScreenPoints[0].x, predScreenPoints[0].y);
          for (let i = 1; i < predScreenPoints.length; i++) {
            ctx.lineTo(predScreenPoints[i].x, predScreenPoints[i].y);
          }
          ctx.stroke();
          ctx.restore();

          // Main dashed line
          ctx.strokeStyle = predColor;
          ctx.lineWidth = 3;
          ctx.setLineDash([10, 6]);
          ctx.lineJoin = "round";
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(predScreenPoints[0].x, predScreenPoints[0].y);
          for (let i = 1; i < predScreenPoints.length; i++) {
            ctx.lineTo(predScreenPoints[i].x, predScreenPoints[i].y);
          }
          ctx.stroke();
          ctx.setLineDash([]);

          // Dots along prediction
          for (let i = 1; i < predScreenPoints.length; i += 2) {
            const pt = predScreenPoints[i];
            const dotR = Math.max(2, 4 * pt.scale);
            ctx.fillStyle = predGlowColor + "0.5)";
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, dotR, 0, Math.PI * 2);
            ctx.fill();
          }

          // ─── IMPACT label ───
          const impSize = Math.max(8, 11 * lastScreen.scale);
          ctx.fillStyle = "#F59E0B";
          ctx.font = `bold ${impSize}px ui-monospace, monospace`;
          ctx.textAlign = "left";
          ctx.fillText("IMPACT", lastScreen.x + 10, lastScreen.y - 10);

          // ─── Decision label near stumps (appears at end) ───
          if (progress > PHASE_STUMPS) {
            const labelAlpha = Math.min(1, (progress - PHASE_STUMPS) / (PHASE_SUMMARY - PHASE_STUMPS));
            const endPred = predScreenPoints[predScreenPoints.length - 1];

            ctx.save();
            ctx.globalAlpha = labelAlpha;

            const labelSize = Math.max(10, 15 * endPred.scale);
            ctx.font = `bold ${labelSize}px ui-monospace, monospace`;
            ctx.textAlign = "left";

            if (isHitting) {
              // "HITTING WICKET" in red with background
              const labelText = "HITTING WICKET";
              const labelW = ctx.measureText(labelText).width;
              const labelPad = 6;
              const labelX = endPred.x + 10;
              const labelY = endPred.y + 5;

              // Background box
              ctx.fillStyle = "rgba(255, 0, 0, 0.2)";
              ctx.beginPath();
              const rr = 3;
              ctx.roundRect(labelX - labelPad, labelY - labelSize + 2, labelW + labelPad * 2, labelSize + labelPad, rr);
              ctx.fill();
              ctx.strokeStyle = "rgba(255, 0, 0, 0.6)";
              ctx.lineWidth = 1;
              ctx.stroke();

              // Text
              ctx.fillStyle = "#FF4444";
              ctx.fillText(labelText, labelX, labelY);

              // Checkmark
              ctx.fillStyle = "#22C55E";
              ctx.font = `bold ${labelSize * 1.2}px ui-monospace, monospace`;
              ctx.fillText("✓", labelX + labelW + 8, labelY + 2);
            } else {
              // "MISSING WICKET" in blue with background
              const labelText = "MISSING WICKET";
              const labelW = ctx.measureText(labelText).width;
              const labelPad = 6;
              const labelX = endPred.x + 10;
              const labelY = endPred.y + 5;

              ctx.fillStyle = "rgba(59, 130, 246, 0.2)";
              ctx.beginPath();
              const rr = 3;
              ctx.roundRect(labelX - labelPad, labelY - labelSize + 2, labelW + labelPad * 2, labelSize + labelPad, rr);
              ctx.fill();
              ctx.strokeStyle = "rgba(59, 130, 246, 0.6)";
              ctx.lineWidth = 1;
              ctx.stroke();

              ctx.fillStyle = "#60A5FA";
              ctx.fillText(labelText, labelX, labelY);

              // X mark
              ctx.fillStyle = "#EF4444";
              ctx.font = `bold ${labelSize * 1.2}px ui-monospace, monospace`;
              ctx.fillText("✗", labelX + labelW + 8, labelY + 2);
            }

            ctx.restore();
          }
        }
      }
    }

    // ═══════════════════════════════════════════════════════
    // ANIMATED CRICKET BALL (red, moves along tracked path)
    // ═══════════════════════════════════════════════════════
    if (visibleCount > 0 && visibleCount <= totalPoints && screenPoints.length > 0 && trajectoryProgress < 1.0) {
      const curr = screenPoints[screenPoints.length - 1];
      const ballR = Math.max(5, 16 * curr.scale);

      drawCricketBall(ctx, curr.x, curr.y, ballR);
    }

    // ═══════════════════════════════════════════════════════
    // BALL SPEED — top right
    // ═══════════════════════════════════════════════════════
    if (progress > PHASE_RELEASE) {
      const speedAlpha = Math.min(1, (progress - PHASE_RELEASE) / 0.05);
      ctx.save();
      ctx.globalAlpha = speedAlpha;

      // Background pill
      const speedText = `${trajectory.ballSpeed} km/h`;
      const speedFS = Math.max(11, w * 0.02);
      ctx.font = `bold ${speedFS}px ui-monospace, monospace`;
      const speedW = ctx.measureText(speedText).width;
      const speedPad = 10;

      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.beginPath();
      ctx.roundRect(w - speedW - speedPad * 2 - 12, 10, speedW + speedPad * 2, speedFS + speedPad, 4);
      ctx.fill();

      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.textAlign = "right";
      ctx.fillText(speedText, w - 12 - speedPad, 10 + speedFS);

      ctx.restore();
    }

    // ═══════════════════════════════════════════════════════
    // LEGEND — bottom bar
    // ═══════════════════════════════════════════════════════
    if (progress > 0.15) {
      const legendAlpha = Math.min(0.7, (progress - 0.15) * 3);
      const legendY = h - 18;
      const legendFS = Math.max(9, w * 0.014);

      ctx.save();
      ctx.globalAlpha = legendAlpha;

      // Semi-transparent background
      ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
      ctx.beginPath();
      ctx.roundRect(10, legendY - 12, w - 20, 24, 4);
      ctx.fill();

      ctx.font = `${legendFS}px ui-monospace, monospace`;
      ctx.textAlign = "left";
      const items: Array<{ x: number; label: string; type: "line" | "dash" | "dot"; color: string }> = [];
      let offsetX = 20;

      // Tracked path
      items.push({ x: offsetX, label: "Tracked Path", type: "line", color: "#FBBF24" });
      offsetX += 100;

      // Predicted path
      items.push({ x: offsetX, label: "Predicted Path", type: "dash", color: isHitting ? "#FF0000" : "#3B82F6" });
      offsetX += 120;

      // Release
      items.push({ x: offsetX, label: "Release", type: "dot", color: "#22d3ee" });
      offsetX += 70;

      // Pitch point
      items.push({ x: offsetX, label: "Pitch Point", type: "dot", color: "#10B981" });
      offsetX += 90;

      // Impact
      items.push({ x: offsetX, label: "Impact", type: "dot", color: "#F59E0B" });

      for (const item of items) {
        if (item.type === "line") {
          ctx.strokeStyle = item.color;
          ctx.lineWidth = 2.5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(item.x, legendY);
          ctx.lineTo(item.x + 16, legendY);
          ctx.stroke();
        } else if (item.type === "dash") {
          ctx.strokeStyle = item.color;
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 3]);
          ctx.beginPath();
          ctx.moveTo(item.x, legendY);
          ctx.lineTo(item.x + 16, legendY);
          ctx.stroke();
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = item.color;
          ctx.beginPath();
          ctx.arc(item.x + 5, legendY, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
        ctx.textAlign = "left";
        ctx.fillText(item.label, item.x + 20, legendY + 4);
      }

      ctx.restore();
    }

    // ═══════════════════════════════════════════════════════
    // "HAWK-EYE" WATERMARK — bottom-left (subtle)
    // ═══════════════════════════════════════════════════════
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.font = `bold ${Math.max(10, w * 0.018)}px ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.fillText("HAWK-EYE", 14, 24);

    // ═══════════════════════════════════════════════════════
    // DECISION BADGE — top-left (appears at summary)
    // ═══════════════════════════════════════════════════════
    if (progress > PHASE_SUMMARY) {
      const badgeAlpha = Math.min(1, (progress - PHASE_SUMMARY) / 0.05);
      ctx.save();
      ctx.globalAlpha = badgeAlpha;

      const decisionText = analysisResult.decision === "OUT" ? "OUT" : "NOT OUT";
      const decisionColor = analysisResult.decision === "OUT" ? "#EF4444" : "#22C55E";
      const badgeFS = Math.max(12, w * 0.025);

      ctx.font = `bold ${badgeFS}px ui-monospace, monospace`;
      const badgeW = ctx.measureText(decisionText).width;
      const badgePad = 12;

      // Background pill
      ctx.fillStyle = analysisResult.decision === "OUT"
        ? "rgba(239, 68, 68, 0.2)"
        : "rgba(34, 197, 94, 0.2)";
      ctx.beginPath();
      ctx.roundRect(14, 32, badgeW + badgePad * 2, badgeFS + badgePad, 5);
      ctx.fill();

      ctx.strokeStyle = analysisResult.decision === "OUT"
        ? "rgba(239, 68, 68, 0.6)"
        : "rgba(34, 197, 94, 0.6)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = decisionColor;
      ctx.textAlign = "left";
      ctx.fillText(decisionText, 14 + badgePad, 32 + badgeFS + 4);

      ctx.restore();
    }

  }, [analysisResult, normToPitch]);

  // ─── Animation loop ───
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
        // Increment based on 6-second total duration
        const increment = (deltaMs / ANIM_DURATION_MS) * playbackSpeedRef.current;
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

  // Reset on new analysis result
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
