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
 * DRS / Hawk-Eye style 3D cricket pitch ball tracking visualisation.
 *
 * Based on research of the actual Decision Review System technology used
 * in international cricket (Hawk-Eye by Sony):
 *
 *   - Camera is positioned at an ELEVATED SIDE ANGLE (~28° above horizontal,
 *     from the right side of the pitch looking left) showing the full pitch
 *     length with both sets of stumps clearly visible.
 *   - The pitch is rendered as a green mat with white crease lines on a
 *     dark ground, matching the broadcast overlay style.
 *   - The tracked ball path is shown as a SOLID orange/amber line with
 *     glow effects (like Hawk-Eye's signature style).
 *   - The predicted path (after impact) is shown as a DASHED line —
 *     RED if hitting stumps, BLUE if missing.
 *   - An animated ball sphere travels along the path in real time.
 *   - Pitch point, impact point, and release point are clearly marked.
 *   - Stumps are rendered at BROADCAST SCALE — clearly visible with bails.
 *   - A translucent zone shows where the ball is predicted to hit/miss stumps.
 */

// ─── Physical pitch constants (feet) ───
const PITCH_LENGTH = 66.0;    // 22 yards
const PITCH_WIDTH = 10.0;     // official pitch width
const STUMP_HEIGHT = 2.333;   // 28 inches in feet
const STUMP_SPREAD = 0.75;    // half-width between off & leg stump (9 inches)
const STUMP_THICKNESS = 0.12; // visual stump width
const BAIL_LENGTH = 0.5;      // bail extends past stump tops

// ─── Camera constants ───
// Elevated side angle: camera is above and to the side of the pitch
const CAM_ELEVATION = 35;      // degrees above horizontal
const CAM_AZIMUTH = 15;        // degrees from pure side view
const CAM_DISTANCE = 90;       // distance from pitch centre (feet)
const CAM_HEIGHT_FEET = 38;    // ~11.5m above ground (broadcast crane height)

// ─── Projection ───
const FOCAL_LENGTH = 400;      // focal length in pixels

/** Convert feet to world 3D coordinates relative to pitch centre. */
function worldFromPitch(
  pitchX: number,  // lateral: 0 = centre, + = off side, - = leg side
  pitchY: number,  // along pitch: 0 = bowling crease, 66 = batting crease
  pitchZ: number,  // height above ground (feet)
): { x: number; y: number; z: number } {
  return { x: pitchX, y: pitchY - PITCH_LENGTH / 2, z: pitchZ };
}

/** Project world 3D point to canvas 2D using elevated side camera. */
function project(
  wx: number, wy: number, wz: number,
  cx: number, cy: number, flip: number,
  canvasW: number, canvasH: number,
): { x: number; y: number; scale: number } | null {
  // Camera position: elevated, to the side
  const elevRad = (CAM_ELEVATION * Math.PI) / 180;
  const azRad = (CAM_AZIMUTH * Math.PI) / 180;

  const camX = CAM_DISTANCE * Math.sin(azRad);
  const camY = -CAM_DISTANCE * Math.cos(azRad);
  const camZ = CAM_HEIGHT_FEET;

  // Look-at point: pitch centre at ground level
  const lookX = 0;
  const lookY = 0;
  const lookZ = 0;

  // Camera coordinate system (right-hand rule)
  const forward = {
    x: lookX - camX, y: lookY - camY, z: lookZ - camZ
  };
  const fLen = Math.sqrt(forward.x ** 2 + forward.y ** 2 + forward.z ** 2);
  const fwd = { x: forward.x / fLen, y: forward.y / fLen, z: forward.z / fLen };

  // World up
  const worldUp = { x: 0, y: 0, z: 1 };

  // Right = forward × worldUp (normalized)
  let right = {
    x: fwd.y * worldUp.z - fwd.z * worldUp.y,
    y: fwd.z * worldUp.x - fwd.x * worldUp.z,
    z: fwd.x * worldUp.y - fwd.y * worldUp.x,
  };
  const rLen = Math.sqrt(right.x ** 2 + right.y ** 2 + right.z ** 2);
  right = { x: right.x / rLen, y: right.y / rLen, z: right.z / rLen };

  // Up = right × forward
  const up = {
    x: right.y * fwd.z - right.z * fwd.y,
    y: right.z * fwd.x - right.x * fwd.z,
    z: right.x * fwd.y - right.y * fwd.x,
  };

  // Vector from camera to point
  const dx = wx - camX;
  const dy = wy - camY;
  const dz = wz - camZ;

  // Project into camera space
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

/** Draw a complete set of stumps (3 stumps + 2 bails) at a given pitch Y position. */
function drawStumpSet(
  ctx: CanvasRenderingContext2D,
  pitchY: number,
  cx: number, cy: number, flip: number,
  cw: number, ch: number,
  color: string, highlight: boolean = false,
) {
  const positions = [-STUMP_SPREAD, 0, STUMP_SPREAD];
  const ground = 0;
  const top = STUMP_HEIGHT;

  // Stump colour
  const stumpColor = highlight ? "#ff4444" : color;
  const glowColor = highlight ? "rgba(255, 68, 68, 0.3)" : `${color}33`;

  // Draw each stump
  for (const sx of positions) {
    const wBot = worldFromPitch(sx, pitchY, ground);
    const wTop = worldFromPitch(sx, pitchY, top);
    const bot = project(wBot.x, wBot.y, wBot.z, cx, cy, flip, cw, ch);
    const tp = project(wTop.x, wTop.y, wTop.z, cx, cy, flip, cw, ch);
    if (!bot || !tp) continue;

    const lineW = Math.max(2, 5 * bot.scale);

    // Glow behind stump
    if (highlight) {
      ctx.save();
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = lineW * 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(bot.x, bot.y);
      ctx.lineTo(tp.x, tp.y);
      ctx.stroke();
      ctx.restore();
    }

    // Main stump line
    ctx.strokeStyle = stumpColor;
    ctx.lineWidth = lineW;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(bot.x, bot.y);
    ctx.lineTo(tp.x, tp.y);
    ctx.stroke();
  }

  // Draw bails
  for (let i = 0; i < 2; i++) {
    const sx1 = positions[i];
    const sx2 = positions[i + 1];
    const ext = BAIL_LENGTH * 0.3; // bails extend slightly past stumps
    const w1 = worldFromPitch(sx1 - ext, pitchY, top);
    const w2 = worldFromPitch(sx2 + ext, pitchY, top);
    const p1 = project(w1.x, w1.y, w1.z, cx, cy, flip, cw, ch);
    const p2 = project(w2.x, w2.y, w2.z, cx, cy, flip, cw, ch);
    if (!p1 || !p2) continue;

    const bailW = Math.max(1.5, 3 * p1.scale);
    ctx.strokeStyle = stumpColor;
    ctx.lineWidth = bailW;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }
}

/** Draw the pitch surface as a filled perspective quadrilateral. */
function drawPitchSurface(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, flip: number,
  cw: number, ch: number,
) {
  const hw = PITCH_WIDTH / 2;
  const corners3D = [
    worldFromPitch(-hw, 0, 0),          // bowling crease left
    worldFromPitch(hw, 0, 0),           // bowling crease right
    worldFromPitch(hw, PITCH_LENGTH, 0), // batting crease right
    worldFromPitch(-hw, PITCH_LENGTH, 0),// batting crease left
  ];

  const corners = corners3D.map(c =>
    project(c.x, c.y, c.z, cx, cy, flip, cw, ch)
  );

  if (!corners.every(Boolean)) return;

  const pts = corners as NonNullable<typeof corners>[0];

  // Pitch fill — rich green gradient
  const pitchGrad = ctx.createLinearGradient(cx, pts[0].y, cx, pts[3].y);
  pitchGrad.addColorStop(0, "#1a6b30");
  pitchGrad.addColorStop(0.15, "#1f7d38");
  pitchGrad.addColorStop(0.35, "#228b3b");
  pitchGrad.addColorStop(0.5, "#1f8536");
  pitchGrad.addColorStop(0.65, "#228b3b");
  pitchGrad.addColorStop(0.85, "#1f7d38");
  pitchGrad.addColorStop(1, "#1a6b30");

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = pitchGrad;
  ctx.fill();

  // Mowed grass stripes (alternating light/dark)
  const stripeCount = 22;
  for (let i = 0; i < stripeCount; i += 2) {
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
      ctx.fillStyle = "rgba(0, 0, 0, 0.04)";
      ctx.beginPath();
      ctx.moveTo(p1L.x, p1L.y);
      ctx.lineTo(p1R.x, p1R.y);
      ctx.lineTo(p2R.x, p2R.y);
      ctx.lineTo(p2L.x, p2L.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Pitch outline
  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();
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
   *
   * Backend provides:
   *   x: 0=left, 0.5=centre, 1=right
   *   y: 0=top of frame (bowling end), 1=bottom (batting end)
   *
   * We map to:
   *   pitchX: lateral offset from centre line (feet)
   *   pitchY: along pitch from bowling crease (feet)
   *   pitchZ: estimated height (feet) — parabolic arc
   */
  const normToPitch = useCallback((nx: number, ny: number, t: number = 0) => {
    // Lateral: nx=0.5 → centre, nx=0 → leg side, nx=1 → off side
    // Map to ±3 feet range (reasonable for ball deviation)
    const pitchX = (nx - 0.5) * 6;
    // Along pitch: ny=0 → bowling end, ny=1 → batting end
    const pitchY = ny * PITCH_LENGTH;
    // Height: parabolic arc, peaks around t=0.25 (just after release)
    // Ball released at ~6-7ft height, drops due to gravity
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

    // Projection parameters
    const cx = w * 0.5;
    const cy = h * 0.5;
    const flip = -1; // flip so bowling end is at top

    const { trajectory, frameData } = analysisResult;
    const isHitting = analysisResult.decision === "OUT";
    const totalPoints = frameData.length;

    // ═══════════════════════════════════════════════
    // BACKGROUND — dark broadcast-style
    // ═══════════════════════════════════════════════
    // Dark gradient background (DRS style)
    const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.7);
    bgGrad.addColorStop(0, "#0a1628");
    bgGrad.addColorStop(0.5, "#0d1b2e");
    bgGrad.addColorStop(1, "#061018");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Subtle ground/outfield
    const groundGrad = ctx.createLinearGradient(0, cy - h * 0.15, 0, cy + h * 0.15);
    groundGrad.addColorStop(0, "#0d2a16");
    groundGrad.addColorStop(0.5, "#103d1f");
    groundGrad.addColorStop(1, "#0d2a16");
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, cy - h * 0.15, w, h * 0.3);

    // ═══════════════════════════════════════════════
    // PITCH SURFACE
    // ═══════════════════════════════════════════════
    drawPitchSurface(ctx, cx, cy, flip, w, h);

    // ═══════════════════════════════════════════════
    // CREASE LINES
    // ═══════════════════════════════════════════════
    const creaseHW = PITCH_WIDTH / 2 + 3;

    // Bowling crease
    drawLine3D(ctx, -creaseHW, 0, 0, creaseHW, 0, 0, cx, cy, flip, w, h,
      "rgba(255, 255, 255, 0.7)", 2.5);
    // Bowling return creases (4ft behind)
    drawLine3D(ctx, -creaseHW, -4, 0, -creaseHW, 0, 0, cx, cy, flip, w, h,
      "rgba(255, 255, 255, 0.3)", 1.5);
    drawLine3D(ctx, creaseHW, -4, 0, creaseHW, 0, 0, cx, cy, flip, w, h,
      "rgba(255, 255, 255, 0.3)", 1.5);

    // Batting crease
    drawLine3D(ctx, -creaseHW, PITCH_LENGTH, 0, creaseHW, PITCH_LENGTH, 0, cx, cy, flip, w, h,
      "rgba(255, 255, 255, 0.6)", 2.5);
    // Batting return creases
    drawLine3D(ctx, -creaseHW, PITCH_LENGTH, 0, -creaseHW, PITCH_LENGTH + 4, 0, cx, cy, flip, w, h,
      "rgba(255, 255, 255, 0.25)", 1.5);
    drawLine3D(ctx, creaseHW, PITCH_LENGTH, 0, creaseHW, PITCH_LENGTH + 4, 0, cx, cy, flip, w, h,
      "rgba(255, 255, 255, 0.25)", 1.5);

    // ═══════════════════════════════════════════════
    // STUMPS — BROADCAST SCALE
    // ═══════════════════════════════════════════════

    // Bowling end stumps (closer to camera → larger)
    const bowlingHighlight = false;
    drawStumpSet(ctx, 0, cx, cy, flip, w, h, "rgba(255, 255, 255, 0.9)", bowlingHighlight);

    // Batting end stumps (farther → slightly smaller but clearly visible)
    const battingHighlight = isHitting && progress > 0.85;
    drawStumpSet(ctx, PITCH_LENGTH, cx, cy, flip, w, h, "rgba(255, 255, 255, 0.8)", battingHighlight);

    // ═══════════════════════════════════════════════
    // STUMP HIT ZONE (semi-transparent rectangle at batting stumps)
    // ═══════════════════════════════════════════════
    if (isHitting && progress > 0.75) {
      const alpha = Math.min(0.35, (progress - 0.75) / 0.25 * 0.35);
      const zoneBL = worldFromPitch(-STUMP_SPREAD - 0.3, PITCH_LENGTH - 0.3, 0);
      const zoneBR = worldFromPitch(STUMP_SPREAD + 0.3, PITCH_LENGTH - 0.3, 0);
      const zoneTL = worldFromPitch(-STUMP_SPREAD - 0.3, PITCH_LENGTH + 0.3, STUMP_HEIGHT);
      const zoneTR = worldFromPitch(STUMP_SPREAD + 0.3, PITCH_LENGTH + 0.3, STUMP_HEIGHT);

      const pBL = project(zoneBL.x, zoneBL.y, zoneBL.z, cx, cy, flip, w, h);
      const pBR = project(zoneBR.x, zoneBR.y, zoneBR.z, cx, cy, flip, w, h);
      const pTL = project(zoneTL.x, zoneTL.y, zoneTL.z, cx, cy, flip, w, h);
      const pTR = project(zoneTR.x, zoneTR.y, zoneTR.z, cx, cy, flip, w, h);

      if (pBL && pBR && pTL && pTR) {
        ctx.fillStyle = `rgba(255, 50, 50, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(pBL.x, pBL.y);
        ctx.lineTo(pBR.x, pBR.y);
        ctx.lineTo(pTR.x, pTR.y);
        ctx.lineTo(pTL.x, pTL.y);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = `rgba(255, 80, 80, ${alpha * 1.5})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // ═══════════════════════════════════════════════
    // LABELS
    // ═══════════════════════════════════════════════
    const bowlLabelWorld = worldFromPitch(0, -6, STUMP_HEIGHT * 0.5);
    const bowlLabel = project(bowlLabelWorld.x, bowlLabelWorld.y, bowlLabelWorld.z, cx, cy, flip, w, h);
    if (bowlLabel) {
      const fs = Math.max(9, 14 * bowlLabel.scale);
      ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
      ctx.font = `bold ${fs}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.fillText("BOWLING END", bowlLabel.x, bowlLabel.y);
    }

    const batLabelWorld = worldFromPitch(0, PITCH_LENGTH + 6, STUMP_HEIGHT * 0.5);
    const batLabel = project(batLabelWorld.x, batLabelWorld.y, batLabelWorld.z, cx, cy, flip, w, h);
    if (batLabel) {
      const fs = Math.max(8, 12 * batLabel.scale);
      ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
      ctx.font = `bold ${fs}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.fillText("BATSMAN END", batLabel.x, batLabel.y);
    }

    // ═══════════════════════════════════════════════
    // BALL TRAJECTORY
    // ═══════════════════════════════════════════════
    if (totalPoints < 2) return;

    const visibleCount = Math.min(Math.floor(progress * totalPoints), totalPoints);

    // Project all visible trajectory points to screen
    const screenPoints: { x: number; y: number; scale: number; pitchZ: number }[] = [];
    for (let i = 0; i < visibleCount; i++) {
      const fd = frameData[i];
      const t = i / Math.max(totalPoints - 1, 1);
      const pitch = normToPitch(fd.x, fd.y, t);
      const world = worldFromPitch(pitch.pitchX, pitch.pitchY, pitch.pitchZ);
      const sp = project(world.x, world.y, world.z, cx, cy, flip, w, h);
      if (sp) screenPoints.push({ ...sp, pitchZ: pitch.pitchZ });
    }

    if (screenPoints.length < 2) {
      if (screenPoints.length === 1) {
        const p = screenPoints[0];
        const dotR = Math.max(4, 14 * p.scale);
        ctx.fillStyle = "#22d3ee";
        ctx.beginPath();
        ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `bold ${Math.max(9, 12 * p.scale)}px ui-monospace, monospace`;
        ctx.textAlign = "left";
        ctx.fillStyle = "#22d3ee";
        ctx.fillText("RELEASE", p.x + dotR + 5, p.y + 3);
      }
      return;
    }

    // ─── TRACKED PATH: outer glow ───
    ctx.save();
    ctx.strokeStyle = "rgba(251, 191, 36, 0.1)";
    ctx.lineWidth = 16;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
    for (let i = 1; i < screenPoints.length; i++) {
      ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();

    // ─── TRACKED PATH: inner glow ───
    ctx.save();
    ctx.strokeStyle = "rgba(251, 191, 36, 0.25)";
    ctx.lineWidth = 7;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(screenPoints[0].x, screenPoints[0].y);
    for (let i = 1; i < screenPoints.length; i++) {
      ctx.lineTo(screenPoints[i].x, screenPoints[i].y);
    }
    ctx.stroke();
    ctx.restore();

    // ─── TRACKED PATH: main solid line ───
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

    // ─── TRACKED PATH: dots at intervals ───
    for (let i = 0; i < screenPoints.length; i += 2) {
      const pt = screenPoints[i];
      const t = i / (totalPoints - 1);
      const dotR = Math.max(1.5, 3.5 * pt.scale);
      ctx.fillStyle = t > 0.75
        ? (isHitting ? "rgba(239, 68, 68, 0.6)" : "rgba(59, 130, 246, 0.6)")
        : "rgba(251, 191, 36, 0.5)";
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    // ─── RELEASE POINT marker ───
    const relPt = screenPoints[0];
    const relR = Math.max(5, 16 * relPt.scale);
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
    ctx.font = `bold ${Math.max(9, 12 * relPt.scale)}px ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.fillText("RELEASE", relPt.x + relR + 6, relPt.y + 4);

    // ═══════════════════════════════════════════════
    // PREDICTED PATH (after impact — dashed line)
    // ═══════════════════════════════════════════════
    const predStartProgress = 0.72;
    if (progress > predStartProgress && trajectory.predictedPathPoints.length > 0) {
      const predProgress = Math.min(1.0, (progress - predStartProgress) / (1.0 - predStartProgress));
      const predVisibleCount = Math.floor(predProgress * trajectory.predictedPathPoints.length);
      const lastScreen = screenPoints[screenPoints.length - 1];

      const predScreenPoints: { x: number; y: number; scale: number }[] = [lastScreen];
      for (let i = 0; i < predVisibleCount; i++) {
        const pp = trajectory.predictedPathPoints[i];
        const t = i / Math.max(trajectory.predictedPathPoints.length - 1, 1);
        // Predicted path: ball drops from pad height toward stumps
        const pitchZ = Math.max(0, 2.5 * (1 - t * 1.3));
        const pitchX = (pp.x - 0.5) * 6;
        const pitchY = pp.y * PITCH_LENGTH;
        const world = worldFromPitch(pitchX, pitchY, pitchZ);
        const sp = project(world.x, world.y, world.z, cx, cy, flip, w, h);
        if (sp) predScreenPoints.push(sp);
      }

      if (predScreenPoints.length > 1) {
        // Glow
        ctx.save();
        ctx.strokeStyle = isHitting ? "rgba(239, 68, 68, 0.1)" : "rgba(59, 130, 246, 0.1)";
        ctx.lineWidth = 14;
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(predScreenPoints[0].x, predScreenPoints[0].y);
        for (let i = 1; i < predScreenPoints.length; i++) {
          ctx.lineTo(predScreenPoints[i].x, predScreenPoints[i].y);
        }
        ctx.stroke();
        ctx.restore();

        // Dashed line
        const predColor = isHitting ? "rgba(239, 68, 68, 0.8)" : "rgba(59, 130, 246, 0.8)";
        ctx.strokeStyle = predColor;
        ctx.lineWidth = 2.5;
        ctx.setLineDash([10, 6]);
        ctx.lineJoin = "round";
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
          const dotR = Math.max(1.5, 3 * pt.scale);
          ctx.fillStyle = isHitting ? "rgba(239, 68, 68, 0.5)" : "rgba(59, 130, 246, 0.5)";
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, dotR, 0, Math.PI * 2);
          ctx.fill();
        }

        // End label (HITTING STUMPS / MISSING STUMPS)
        const endPred = predScreenPoints[predScreenPoints.length - 1];
        const labelSize = Math.max(9, 13 * endPred.scale);
        ctx.fillStyle = isHitting ? "#ef4444" : "#3b82f6";
        ctx.font = `bold ${labelSize}px ui-monospace, monospace`;
        ctx.textAlign = "left";
        ctx.fillText(
          isHitting ? "HITTING STUMPS" : "MISSING STUMPS",
          endPred.x + 8, endPred.y + 4
        );

        // Impact label
        const impSize = Math.max(8, 11 * lastScreen.scale);
        ctx.fillStyle = "#fbbf24";
        ctx.font = `bold ${impSize}px ui-monospace, monospace`;
        ctx.fillText("IMPACT", lastScreen.x + 8, lastScreen.y - 8);
      }
    }

    // ═══════════════════════════════════════════════
    // PITCH POINT marker
    // ═══════════════════════════════════════════════
    if (trajectory.pitchPoint && progress > 0.25) {
      const pp = trajectory.pitchPoint;
      const pitchX = (pp.x - 0.5) * 6;
      const pitchY = pp.y * PITCH_LENGTH;
      const world = worldFromPitch(pitchX, pitchY, 0);
      const sp = project(world.x, world.y, world.z, cx, cy, flip, w, h);
      if (sp) {
        const pr = Math.max(4, 12 * sp.scale);
        // Glow
        const pitchGlow = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, pr * 3);
        pitchGlow.addColorStop(0, "rgba(16, 185, 129, 0.5)");
        pitchGlow.addColorStop(1, "transparent");
        ctx.fillStyle = pitchGlow;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, pr * 3, 0, Math.PI * 2);
        ctx.fill();
        // Dot
        ctx.fillStyle = "#10b981";
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, pr, 0, Math.PI * 2);
        ctx.fill();
        // Crosshair
        ctx.strokeStyle = "#10b981";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sp.x - pr * 1.5, sp.y);
        ctx.lineTo(sp.x + pr * 1.5, sp.y);
        ctx.moveTo(sp.x, sp.y - pr * 1.5);
        ctx.lineTo(sp.x, sp.y + pr * 1.5);
        ctx.stroke();
        // Label
        const pLabelSize = Math.max(8, 11 * sp.scale);
        ctx.font = `bold ${pLabelSize}px ui-monospace, monospace`;
        ctx.textAlign = "left";
        ctx.fillStyle = "#10b981";
        ctx.fillText("PITCH", sp.x + pr * 2, sp.y - pr);
      }
    }

    // ═══════════════════════════════════════════════
    // ANIMATED BALL (moves along tracked path)
    // ═══════════════════════════════════════════════
    if (visibleCount > 0 && visibleCount <= totalPoints && screenPoints.length > 0) {
      const curr = screenPoints[screenPoints.length - 1];
      const t = visibleCount / Math.max(totalPoints - 1, 1);
      let ballColor = "#f59e0b";
      if (t >= 0.75) ballColor = isHitting ? "#ef4444" : "#3b82f6";

      const ballR = Math.max(5, 18 * curr.scale);

      // Large outer glow
      const largeGlow = ctx.createRadialGradient(curr.x, curr.y, 0, curr.x, curr.y, ballR * 4);
      largeGlow.addColorStop(0, ballColor + "50");
      largeGlow.addColorStop(0.4, ballColor + "20");
      largeGlow.addColorStop(1, "transparent");
      ctx.fillStyle = largeGlow;
      ctx.beginPath();
      ctx.arc(curr.x, curr.y, ballR * 4, 0, Math.PI * 2);
      ctx.fill();

      // Ball body
      const ballGrad = ctx.createRadialGradient(
        curr.x - ballR * 0.3, curr.y - ballR * 0.3, 0,
        curr.x, curr.y, ballR
      );
      ballGrad.addColorStop(0, "#ffffff");
      ballGrad.addColorStop(0.3, ballColor);
      ballGrad.addColorStop(1, ballColor + "aa");
      ctx.fillStyle = ballGrad;
      ctx.beginPath();
      ctx.arc(curr.x, curr.y, ballR, 0, Math.PI * 2);
      ctx.fill();

      // Highlight
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath();
      ctx.arc(curr.x - ballR * 0.3, curr.y - ballR * 0.3, ballR * 0.35, 0, Math.PI * 2);
      ctx.fill();
    }

    // ═══════════════════════════════════════════════
    // BALL SPEED (top right)
    // ═══════════════════════════════════════════════
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = `bold ${Math.max(10, w * 0.02)}px ui-monospace, monospace`;
    ctx.textAlign = "right";
    ctx.fillText(`${trajectory.ballSpeed} km/h`, w - 15, 24);

    // ═══════════════════════════════════════════════
    // LEGEND (bottom)
    // ═══════════════════════════════════════════════
    const legendY = h - 14;
    const legendFS = Math.max(8, w * 0.014);
    ctx.font = `${legendFS}px ui-monospace, monospace`;
    ctx.textAlign = "left";

    // Tracked
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(14, legendY - 3.5, 12, 3);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText("Tracked Path", 30, legendY);

    // Predicted
    const predX = 130;
    ctx.setLineDash([3, 2]);
    ctx.strokeStyle = isHitting ? "#ef4444" : "#3b82f6";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(predX, legendY - 2);
    ctx.lineTo(predX + 14, legendY - 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText("Predicted Path", predX + 18, legendY);

    // Release
    const relX = 240;
    ctx.fillStyle = "#22d3ee";
    ctx.beginPath();
    ctx.arc(relX, legendY - 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText("Release", relX + 7, legendY);

    // Pitch
    const ptX = 300;
    ctx.fillStyle = "#10b981";
    ctx.beginPath();
    ctx.arc(ptX, legendY - 2, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText("Pitch Point", ptX + 7, legendY);

    // ═══════════════════════════════════════════════
    // "HAWK-EYE STYLE" label (top left)
    // ═══════════════════════════════════════════════
    ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
    ctx.font = `${Math.max(8, w * 0.015)}px ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.fillText("DRS BALL TRACKING  \u00B7  HAWK-EYE STYLE", 14, 20);

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
