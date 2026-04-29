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
 *   - Camera positioned ELEVATED 28° from behind/above bowler's end,
 *     10° azimuth offset — the classic Hawk-Eye isometric view.
 *   - Pitch rendered as DARK OLIVE-GREEN surface (#2D5016) matching
 *     real DRS broadcast footage.
 *   - Outfield: Lighter green (#4A8C2A) surrounding the pitch strip.
 *   - Dark green-black broadcast background with slight green tint.
 *   - Tracked ball path: SOLID RED (#FF0000) with 3D tube shading.
 *   - Predicted path: SOLID BLUE (#0066FF) — NOT dashed.
 *   - Ball: Red cricket ball (#CC0000) with white specular highlight.
 *   - Ball shadow: Dark semi-transparent ellipse projected on pitch surface.
 *   - Stumps: White/cream at broadcast scale, glow RED/ORANGE when hitting.
 *   - LBW criteria labels appear progressively during animation.
 *   - "HAWK-EYE" watermark bottom-left corner.
 *   - Ball speed top-right in km/h.
 *   - Full 5-second animation sequence matching broadcast pacing.
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
const OUTFIELD_MARGIN = 18;    // extra feet of outfield on each side

// ═══════════════════════════════════════════════════════════
// CAMERA CONSTANTS — Hawk-Eye broadcast angles
// ═══════════════════════════════════════════════════════════
const CAM_ELEVATION = 28;      // degrees above horizontal
const CAM_AZIMUTH = 10;        // degrees from center axis (slight offset)
const CAM_DISTANCE = 85;       // distance from pitch centre (feet)
const CAM_HEIGHT_FEET = 32;    // ~9.8m above ground (broadcast crane)

// ═══════════════════════════════════════════════════════════
// PROJECTION
// ═══════════════════════════════════════════════════════════
const FOCAL_LENGTH = 450;      // focal length in pixels (broadcast telephoto look)

// Animation timing (at 1x speed, total ~5 seconds)
const ANIM_DURATION_MS = 5000;
// Phase boundaries (progress 0-1)
const PHASE_SETUP = 0.10;        // 0-0.10: scene setup, pitch/creases/stumps fade in
const PHASE_RELEASE = 0.14;      // 0.10-0.14: release point appears
const PHASE_FLIGHT = 0.44;       // 0.14-0.44: ball in flight, tracked path draws
const PHASE_BOUNCE = 0.52;       // 0.44-0.52: bounce point marker appears
const PHASE_TO_IMPACT = 0.60;    // 0.52-0.60: post-bounce to impact on pad
const PHASE_IMPACT = 0.62;       // 0.60-0.62: impact label appears
const PHASE_PREDICTED = 0.82;    // 0.62-0.82: predicted blue path extends
const PHASE_DECISION = 0.90;     // 0.82-0.90: HITTING/MISSING text
const PHASE_OVERLAY = 1.0;       // 0.90-1.00: final OUT/NOT OUT overlay

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

  // Stump colour — cream when neutral, red-orange when highlighted
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

/** Draw the outfield as a larger perspective quad — LIGHTER GREEN. */
function drawOutfieldSurface(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, flip: number,
  cw: number, ch: number,
  fadeAlpha: number = 1.0,
) {
  const ohw = PITCH_WIDTH / 2 + OUTFIELD_MARGIN;
  const oLen = PITCH_LENGTH + OUTFIELD_MARGIN * 1.5;
  const oStart = -OUTFIELD_MARGIN * 0.75;
  const corners3D = [
    worldFromPitch(-ohw, oStart, 0),
    worldFromPitch(ohw, oStart, 0),
    worldFromPitch(ohw, oStart + oLen, 0),
    worldFromPitch(-ohw, oStart + oLen, 0),
  ];

  const corners = corners3D.map(c =>
    project(c.x, c.y, c.z, cx, cy, flip, cw, ch)
  );

  if (!corners.every(Boolean)) return;
  const pts = corners.filter(Boolean) as { x: number; y: number; scale: number }[];

  ctx.save();
  ctx.globalAlpha = fadeAlpha;

  // ─── Outfield fill — lighter green (#4A8C2A) ───
  const outfieldGrad = ctx.createLinearGradient(cx, pts[0].y, cx, pts[3].y);
  outfieldGrad.addColorStop(0, "#3D7A24");
  outfieldGrad.addColorStop(0.15, "#4A8C2A");
  outfieldGrad.addColorStop(0.50, "#458828");
  outfieldGrad.addColorStop(0.85, "#4A8C2A");
  outfieldGrad.addColorStop(1, "#3D7A24");

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = outfieldGrad;
  ctx.fill();

  // Subtle mowed grass stripes on outfield
  const stripeCount = 30;
  for (let i = 0; i < stripeCount; i++) {
    const y1 = oStart + (i / stripeCount) * oLen;
    const y2 = oStart + ((i + 1) / stripeCount) * oLen;

    const s1L = worldFromPitch(-ohw, y1, 0);
    const s1R = worldFromPitch(ohw, y1, 0);
    const s2L = worldFromPitch(-ohw, y2, 0);
    const s2R = worldFromPitch(ohw, y2, 0);

    const p1L = project(s1L.x, s1L.y, s1L.z, cx, cy, flip, cw, ch);
    const p1R = project(s1R.x, s1R.y, s1R.z, cx, cy, flip, cw, ch);
    const p2L = project(s2L.x, s2L.y, s2L.z, cx, cy, flip, cw, ch);
    const p2R = project(s2R.x, s2R.y, s2R.z, cx, cy, flip, cw, ch);

    if (p1L && p1R && p2L && p2R) {
      ctx.fillStyle = i % 2 === 0
        ? "rgba(0, 0, 0, 0.04)"
        : "rgba(255, 255, 255, 0.02)";
      ctx.beginPath();
      ctx.moveTo(p1L.x, p1L.y);
      ctx.lineTo(p1R.x, p1R.y);
      ctx.lineTo(p2R.x, p2R.y);
      ctx.lineTo(p2L.x, p2L.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  ctx.restore();
}

/** Draw the pitch surface as a filled perspective quad — DARK OLIVE-GREEN. */
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

  // ─── Pitch fill — DARK OLIVE-GREEN (#2D5016) ───
  const pitchGrad = ctx.createLinearGradient(cx, pts[0].y, cx, pts[3].y);
  pitchGrad.addColorStop(0, "#345C1B");
  pitchGrad.addColorStop(0.10, "#2D5016");
  pitchGrad.addColorStop(0.25, "#31551A");
  pitchGrad.addColorStop(0.50, "#2D5016");
  pitchGrad.addColorStop(0.75, "#31551A");
  pitchGrad.addColorStop(0.90, "#2D5016");
  pitchGrad.addColorStop(1, "#345C1B");

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.fillStyle = pitchGrad;
  ctx.fill();

  // ─── Subtle mowed grass stripes on pitch (alternating lighter/darker strips) ───
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
      // Alternating subtle dark/light stripes on the green surface
      ctx.fillStyle = i % 2 === 0
        ? "rgba(0, 0, 0, 0.06)"
        : "rgba(255, 255, 255, 0.03)";
      ctx.beginPath();
      ctx.moveTo(p1L.x, p1L.y);
      ctx.lineTo(p1R.x, p1R.y);
      ctx.lineTo(p2R.x, p2R.y);
      ctx.lineTo(p2L.x, p2L.y);
      ctx.closePath();
      ctx.fill();
    }
  }

  // ─── Pitch outline — thin white line ───
  ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
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

/**
 * Draw a ball shadow on the pitch surface.
 * Projects the ball's world position down to z=0 and draws a dark ellipse.
 */
function drawBallShadow(
  ctx: CanvasRenderingContext2D,
  ballWorldX: number,  // lateral pitch coordinate
  ballWorldY: number,  // along-pitch coordinate
  ballWorldZ: number,  // height above ground
  cx: number, cy: number, flip: number,
  cw: number, ch: number,
) {
  // Project shadow position (z=0) and ball position to get offset
  const shadowWorld = worldFromPitch(ballWorldX, ballWorldY, 0);
  const shadowScreen = project(shadowWorld.x, shadowWorld.y, shadowWorld.z, cx, cy, flip, cw, ch);
  if (!shadowScreen) return;

  // Shadow size scales with height — higher ball = larger, more diffuse shadow
  const baseRadius = Math.max(3, 8 * shadowScreen.scale);
  const heightFactor = Math.min(2.5, 1 + ballWorldZ * 0.25);
  const shadowRadiusX = baseRadius * heightFactor;
  const shadowRadiusY = baseRadius * heightFactor * 0.45; // perspective squash

  // Shadow opacity decreases with height
  const shadowAlpha = Math.max(0.08, 0.4 - ballWorldZ * 0.04);

  ctx.save();
  ctx.globalAlpha = shadowAlpha;
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.beginPath();
  ctx.ellipse(
    shadowScreen.x, shadowScreen.y,
    shadowRadiusX, shadowRadiusY,
    0, 0, Math.PI * 2
  );
  ctx.fill();
  ctx.restore();
}

/**
 * Draw a 3D tube-shaded path line with depth illusion.
 * Uses multiple layered strokes of decreasing width and increasing brightness.
 */
function drawTubePath(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  color: string,
  glowColorBase: string,  // e.g. "rgba(255, 0, 0,"
) {
  if (points.length < 2) return;

  // Layer 1: Wide soft glow
  ctx.save();
  ctx.strokeStyle = glowColorBase + "0.06)";
  ctx.lineWidth = 22;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();

  // Layer 2: Medium glow
  ctx.save();
  ctx.strokeStyle = glowColorBase + "0.15)";
  ctx.lineWidth = 12;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();

  // Layer 3: Inner glow
  ctx.save();
  ctx.strokeStyle = glowColorBase + "0.35)";
  ctx.lineWidth = 6;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();

  // Layer 4: Main solid line
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();

  // Layer 5: Core bright highlight (tube specular)
  ctx.save();
  ctx.strokeStyle = glowColorBase + "0.5)";
  ctx.lineWidth = 1.2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Easing function for smooth animation. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * Determine LBW criteria from trajectory data.
 * Pitching: IN LINE if pitchPoint.x is between ~0.3-0.7 (within stumps width), else OUTSIDE
 * Impact: IN LINE if impactPoint.x is similarly within stumps, else OUTSIDE
 */
function getLBWCriteria(trajectory: {
  pitchPoint: { x: number; y: number };
  impactPoint: { x: number; y: number };
  predictedPath: "HITTING" | "MISSING";
}): {
  pitching: "IN LINE" | "OUTSIDE";
  impact: "IN LINE" | "OUTSIDE";
  hitting: "YES" | "NO";
} {
  const stumpsLeft = 0.35;  // normalized left stump boundary
  const stumpsRight = 0.65; // normalized right stump boundary

  const pitchX = trajectory.pitchPoint.x;
  const impactX = trajectory.impactPoint.x;

  return {
    pitching: (pitchX >= stumpsLeft && pitchX <= stumpsRight) ? "IN LINE" : "OUTSIDE",
    impact: (impactX >= stumpsLeft && impactX <= stumpsRight) ? "IN LINE" : "OUTSIDE",
    hitting: trajectory.predictedPath === "HITTING" ? "YES" : "NO",
  };
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
    const lbwCriteria = getLBWCriteria(trajectory);

    // ═══════════════════════════════════════════════════════
    // BACKGROUND — dark almost-black with green tint
    // ═══════════════════════════════════════════════════════
    const bgGrad = ctx.createRadialGradient(cx, cy * 0.9, 0, cx, cy, w * 0.8);
    bgGrad.addColorStop(0, "#0d1f0d");
    bgGrad.addColorStop(0.3, "#0a1a0a");
    bgGrad.addColorStop(0.6, "#071207");
    bgGrad.addColorStop(1, "#040c04");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // ═══════════════════════════════════════════════════════
    // PHASE: SETUP — scene fade-in
    // ═══════════════════════════════════════════════════════
    const setupAlpha = progress < PHASE_SETUP
      ? easeOutCubic(progress / PHASE_SETUP)
      : 1.0;

    // ═══════════════════════════════════════════════════════
    // OUTFIELD SURFACE — LIGHTER GREEN
    // ═══════════════════════════════════════════════════════
    drawOutfieldSurface(ctx, cx, cy, flip, w, h, setupAlpha);

    // ═══════════════════════════════════════════════════════
    // PITCH SURFACE — DARK OLIVE-GREEN (#2D5016)
    // ═══════════════════════════════════════════════════════
    drawPitchSurface(ctx, cx, cy, flip, w, h, setupAlpha);

    // ═══════════════════════════════════════════════════════
    // CREASE LINES — thin white lines
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
    const stumpsHighlightAlpha = progress > PHASE_DECISION && isHitting
      ? Math.min(1, (progress - PHASE_DECISION) / (PHASE_OVERLAY - PHASE_DECISION))
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
      const alpha = Math.min(0.3, (progress - PHASE_PREDICTED) / (PHASE_DECISION - PHASE_PREDICTED) * 0.3);
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
    // BALL TRAJECTORY — tracked path (SOLID RED)
    // ═══════════════════════════════════════════════════════
    if (totalPoints < 2) return;

    // Calculate how many points are visible based on progress
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

    // Project all visible trajectory points and track world coords for shadow
    const screenPoints: { x: number; y: number; scale: number; pitchZ: number; worldX: number; worldY: number }[] = [];
    for (let i = 0; i < visibleCount; i++) {
      const fd = frameData[i];
      const t = i / Math.max(totalPoints - 1, 1);
      const pitch = normToPitch(fd.x, fd.y, t);
      const world = worldFromPitch(pitch.pitchX, pitch.pitchY, pitch.pitchZ);
      const sp = project(world.x, world.y, world.z, cx, cy, flip, w, h);
      if (sp) screenPoints.push({ ...sp, pitchZ: pitch.pitchZ, worldX: pitch.pitchX, worldY: pitch.pitchY });
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
      relGlow.addColorStop(0, "rgba(255, 80, 80, 0.4)");
      relGlow.addColorStop(1, "transparent");
      ctx.fillStyle = relGlow;
      ctx.beginPath();
      ctx.arc(relPt.x, relPt.y, relR * 3, 0, Math.PI * 2);
      ctx.fill();

      // Dot
      ctx.fillStyle = "#FF4444";
      ctx.beginPath();
      ctx.arc(relPt.x, relPt.y, relR, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = "#FF6666";
      ctx.font = `bold ${Math.max(8, 11 * relPt.scale)}px ui-monospace, monospace`;
      ctx.textAlign = "left";
      ctx.fillText("RELEASE", relPt.x + relR + 5, relPt.y + 3);

      ctx.restore();
    }

    // ─── TRACKED PATH — SOLID RED with 3D tube shading ───
    if (screenPoints.length >= 2) {
      const pts = screenPoints.map(p => ({ x: p.x, y: p.y }));
      drawTubePath(ctx, pts, "#FF0000", "rgba(255, 0, 0,");
    }

    // ═══════════════════════════════════════════════════════
    // PITCH BOUNCE POINT marker — WHITE circle
    // ═══════════════════════════════════════════════════════
    if (trajectory.pitchPoint && progress > PHASE_BOUNCE) {
      const pitchAlpha = Math.min(1, (progress - PHASE_BOUNCE) / 0.04);
      const pp = trajectory.pitchPoint;
      const pitchX = (pp.x - 0.5) * 6;
      const pitchY = pp.y * PITCH_LENGTH;
      const world = worldFromPitch(pitchX, pitchY, 0);
      const sp = project(world.x, world.y, world.z, cx, cy, flip, w, h);
      if (sp) {
        const pr = Math.max(4, 11 * sp.scale);

        ctx.save();
        ctx.globalAlpha = pitchAlpha;

        // Outer ring glow
        const pitchGlow = ctx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, pr * 3);
        pitchGlow.addColorStop(0, "rgba(255, 255, 255, 0.3)");
        pitchGlow.addColorStop(0.5, "rgba(255, 255, 255, 0.1)");
        pitchGlow.addColorStop(1, "transparent");
        ctx.fillStyle = pitchGlow;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, pr * 3, 0, Math.PI * 2);
        ctx.fill();

        // White circle outline
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, pr, 0, Math.PI * 2);
        ctx.stroke();

        // Inner dot
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, pr * 0.3, 0, Math.PI * 2);
        ctx.fill();

        // Crosshair
        ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(sp.x - pr * 2, sp.y);
        ctx.lineTo(sp.x - pr * 1.2, sp.y);
        ctx.moveTo(sp.x + pr * 1.2, sp.y);
        ctx.lineTo(sp.x + pr * 2, sp.y);
        ctx.moveTo(sp.x, sp.y - pr * 2);
        ctx.lineTo(sp.x, sp.y - pr * 1.2);
        ctx.moveTo(sp.x, sp.y + pr * 1.2);
        ctx.lineTo(sp.x, sp.y + pr * 2);
        ctx.stroke();

        // Label
        ctx.font = `bold ${Math.max(8, 10 * sp.scale)}px ui-monospace, monospace`;
        ctx.textAlign = "left";
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText("PITCH", sp.x + pr * 2.5, sp.y - pr);

        ctx.restore();
      }
    }

    // ═══════════════════════════════════════════════════════
    // PREDICTED PATH (after impact — SOLID BLUE #0066FF)
    // ═══════════════════════════════════════════════════════
    if (progress > PHASE_IMPACT && trajectory.predictedPathPoints.length > 0) {
      const predProgress = easeOutCubic(
        Math.min(1, (progress - PHASE_IMPACT) / (PHASE_DECISION - PHASE_IMPACT))
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
          // SOLID BLUE predicted path with 3D tube shading
          const pts = predScreenPoints.map(p => ({ x: p.x, y: p.y }));
          drawTubePath(ctx, pts, "#0066FF", "rgba(0, 102, 255,");

          // ─── IMPACT label ───
          const impAlpha = Math.min(1, (progress - PHASE_IMPACT) / 0.03);
          ctx.save();
          ctx.globalAlpha = impAlpha;
          const impSize = Math.max(8, 11 * lastScreen.scale);
          ctx.fillStyle = "#FFAA00";
          ctx.font = `bold ${impSize}px ui-monospace, monospace`;
          ctx.textAlign = "left";
          ctx.fillText("IMPACT", lastScreen.x + 10, lastScreen.y - 10);
          ctx.restore();

          // ─── Decision label near stumps (appears at PHASE_DECISION) ───
          if (progress > PHASE_DECISION) {
            const labelAlpha = Math.min(1, (progress - PHASE_DECISION) / (PHASE_OVERLAY - PHASE_DECISION));
            const endPred = predScreenPoints[predScreenPoints.length - 1];

            ctx.save();
            ctx.globalAlpha = labelAlpha;

            const labelSize = Math.max(10, 15 * endPred.scale);
            ctx.font = `bold ${labelSize}px ui-monospace, monospace`;
            ctx.textAlign = "left";

            if (isHitting) {
              const labelText = "HITTING";
              const labelW = ctx.measureText(labelText).width;
              const labelPad = 6;
              const labelX = endPred.x + 10;
              const labelY = endPred.y + 5;

              // Background box
              ctx.fillStyle = "rgba(255, 0, 0, 0.2)";
              ctx.beginPath();
              ctx.roundRect(labelX - labelPad, labelY - labelSize + 2, labelW + labelPad * 2, labelSize + labelPad, 3);
              ctx.fill();
              ctx.strokeStyle = "rgba(255, 0, 0, 0.6)";
              ctx.lineWidth = 1;
              ctx.stroke();

              ctx.fillStyle = "#FF4444";
              ctx.fillText(labelText, labelX, labelY);
            } else {
              const labelText = "MISSING";
              const labelW = ctx.measureText(labelText).width;
              const labelPad = 6;
              const labelX = endPred.x + 10;
              const labelY = endPred.y + 5;

              ctx.fillStyle = "rgba(0, 102, 255, 0.2)";
              ctx.beginPath();
              ctx.roundRect(labelX - labelPad, labelY - labelSize + 2, labelW + labelPad * 2, labelSize + labelPad, 3);
              ctx.fill();
              ctx.strokeStyle = "rgba(0, 102, 255, 0.6)";
              ctx.lineWidth = 1;
              ctx.stroke();

              ctx.fillStyle = "#4499FF";
              ctx.fillText(labelText, labelX, labelY);
            }

            ctx.restore();
          }

          // ─── Ball follows predicted path ───
          if (progress < PHASE_DECISION && predScreenPoints.length > 1) {
            const ballPt = predScreenPoints[predScreenPoints.length - 1];
            const ballR = Math.max(5, 14 * ballPt.scale);

            // Ball shadow on pitch surface
            const lastPredIdx = predVisibleCount - 1;
            if (lastPredIdx >= 0 && lastPredIdx < trajectory.predictedPathPoints.length) {
              const pp = trajectory.predictedPathPoints[lastPredIdx];
              const t = lastPredIdx / Math.max(trajectory.predictedPathPoints.length - 1, 1);
              const pitchZ = Math.max(0, 2.5 * (1 - t * 1.3));
              const pitchX = (pp.x - 0.5) * 6;
              const pitchY = pp.y * PITCH_LENGTH;
              drawBallShadow(ctx, pitchX, pitchY, pitchZ, cx, cy, flip, w, h);
            }

            drawCricketBall(ctx, ballPt.x, ballPt.y, ballR);
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

      // Draw ball shadow on pitch surface below ball
      drawBallShadow(ctx, curr.worldX, curr.worldY, curr.pitchZ, cx, cy, flip, w, h);

      // Draw ball
      drawCricketBall(ctx, curr.x, curr.y, ballR);
    }

    // ═══════════════════════════════════════════════════════
    // BALL SPEED — top right
    // ═══════════════════════════════════════════════════════
    if (progress > PHASE_RELEASE) {
      const speedAlpha = Math.min(1, (progress - PHASE_RELEASE) / 0.05);
      ctx.save();
      ctx.globalAlpha = speedAlpha;

      const speedText = `${trajectory.ballSpeed} km/h`;
      const speedFS = Math.max(11, w * 0.02);
      ctx.font = `bold ${speedFS}px ui-monospace, monospace`;
      const speedW = ctx.measureText(speedText).width;
      const speedPad = 10;

      ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
      ctx.beginPath();
      ctx.roundRect(w - speedW - speedPad * 2 - 12, 10, speedW + speedPad * 2, speedFS + speedPad, 4);
      ctx.fill();

      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.textAlign = "right";
      ctx.fillText(speedText, w - 12 - speedPad, 10 + speedFS);

      ctx.restore();
    }

    // ═══════════════════════════════════════════════════════
    // LBW CRITERIA PANEL — right side, appears progressively
    // ═══════════════════════════════════════════════════════
    if (progress > PHASE_BOUNCE) {
      const panelAlpha = Math.min(0.9, (progress - PHASE_BOUNCE) * 3);
      const panelFS = Math.max(10, w * 0.016);
      const lineH = panelFS * 1.8;
      const panelPadX = 12;
      const panelPadY = 10;
      const panelW = 160;
      const panelX = w - panelW - 16;
      const panelBaseY = 50;

      ctx.save();
      ctx.globalAlpha = panelAlpha;

      // Panel background
      ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
      ctx.beginPath();
      ctx.roundRect(panelX - panelPadX, panelBaseY - panelPadY, panelW + panelPadX * 2, lineH * 3 + panelPadY * 2 + 8, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = `bold ${panelFS}px ui-monospace, monospace`;
      ctx.textAlign = "left";

      // ── PITCHING ──
      const pitchingAppear = progress > PHASE_BOUNCE
        ? Math.min(1, (progress - PHASE_BOUNCE) / 0.06)
        : 0;
      ctx.globalAlpha = panelAlpha * pitchingAppear;
      const pitchingColor = lbwCriteria.pitching === "IN LINE" ? "#22C55E" : "#F59E0B";
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.fillText("PITCHING:", panelX, panelBaseY + panelFS);
      ctx.fillStyle = pitchingColor;
      ctx.fillText(lbwCriteria.pitching, panelX + panelW - ctx.measureText(lbwCriteria.pitching).width, panelBaseY + panelFS);

      // ── IMPACT ──
      const impactAppear = progress > PHASE_IMPACT
        ? Math.min(1, (progress - PHASE_IMPACT) / 0.06)
        : 0;
      ctx.globalAlpha = panelAlpha * impactAppear;
      const impactColor = lbwCriteria.impact === "IN LINE" ? "#22C55E" : "#F59E0B";
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.fillText("IMPACT:", panelX, panelBaseY + panelFS + lineH);
      ctx.fillStyle = impactColor;
      ctx.fillText(lbwCriteria.impact, panelX + panelW - ctx.measureText(lbwCriteria.impact).width, panelBaseY + panelFS + lineH);

      // ── HITTING ──
      const hittingAppear = progress > PHASE_DECISION
        ? Math.min(1, (progress - PHASE_DECISION) / 0.06)
        : 0;
      ctx.globalAlpha = panelAlpha * hittingAppear;
      const hittingColor = lbwCriteria.hitting === "YES" ? "#22C55E" : "#EF4444";
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.fillText("HITTING:", panelX, panelBaseY + panelFS + lineH * 2);
      ctx.fillStyle = hittingColor;
      ctx.fillText(lbwCriteria.hitting, panelX + panelW - ctx.measureText(lbwCriteria.hitting).width, panelBaseY + panelFS + lineH * 2);

      ctx.restore();
    }

    // ═══════════════════════════════════════════════════════
    // LEGEND — bottom bar
    // ═══════════════════════════════════════════════════════
    if (progress > 0.18) {
      const legendAlpha = Math.min(0.65, (progress - 0.18) * 3);
      const legendY = h - 18;
      const legendFS = Math.max(9, w * 0.013);

      ctx.save();
      ctx.globalAlpha = legendAlpha;

      // Semi-transparent background
      ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
      ctx.beginPath();
      ctx.roundRect(10, legendY - 12, w - 20, 24, 4);
      ctx.fill();

      ctx.font = `${legendFS}px ui-monospace, monospace`;
      ctx.textAlign = "left";
      const items: Array<{ x: number; label: string; type: "line" | "dot"; color: string }> = [];
      let offsetX = 20;

      // Tracked path — RED solid
      items.push({ x: offsetX, label: "Tracked Path", type: "line", color: "#FF0000" });
      offsetX += 100;

      // Predicted path — BLUE solid
      items.push({ x: offsetX, label: "Predicted Path", type: "line", color: "#0066FF" });
      offsetX += 110;

      // Release
      items.push({ x: offsetX, label: "Release", type: "dot", color: "#FF4444" });
      offsetX += 65;

      // Pitch point
      items.push({ x: offsetX, label: "Pitch Point", type: "dot", color: "#FFFFFF" });
      offsetX += 85;

      // Impact
      items.push({ x: offsetX, label: "Impact", type: "dot", color: "#FFAA00" });

      for (const item of items) {
        if (item.type === "line") {
          ctx.strokeStyle = item.color;
          ctx.lineWidth = 2.5;
          ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(item.x, legendY);
          ctx.lineTo(item.x + 16, legendY);
          ctx.stroke();
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
    // "HAWK-EYE" WATERMARK — bottom-left
    // ═══════════════════════════════════════════════════════
    const hawkEyeAlpha = Math.min(0.25, (progress / PHASE_SETUP) * 0.25);
    ctx.save();
    ctx.globalAlpha = hawkEyeAlpha;
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `bold ${Math.max(12, w * 0.02)}px ui-monospace, monospace`;
    ctx.textAlign = "left";
    ctx.fillText("HAWK-EYE", 14, h - 32);
    ctx.restore();

    // ═══════════════════════════════════════════════════════
    // DECISION OVERLAY — OUT/NOT OUT (appears at final phase)
    // ═══════════════════════════════════════════════════════
    if (progress > PHASE_OVERLAY) {
      const badgeAlpha = Math.min(1, (progress - PHASE_OVERLAY) / 0.05);
      ctx.save();
      ctx.globalAlpha = badgeAlpha;

      const isOut = analysisResult.decision === "OUT";
      const decisionText = isOut ? "OUT" : "NOT OUT";
      const decisionColor = isOut ? "#EF4444" : "#22C55E";
      const badgeFS = Math.max(14, w * 0.032);

      ctx.font = `bold ${badgeFS}px ui-monospace, monospace`;
      const badgeW = ctx.measureText(decisionText).width;
      const badgePad = 14;

      // Large background pill — centered at top
      const badgeX = (w - badgeW - badgePad * 2) / 2;
      const badgeY = 12;

      ctx.fillStyle = isOut ? "rgba(239, 68, 68, 0.25)" : "rgba(34, 197, 94, 0.25)";
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeW + badgePad * 2, badgeFS + badgePad, 6);
      ctx.fill();

      ctx.strokeStyle = isOut ? "rgba(239, 68, 68, 0.7)" : "rgba(34, 197, 94, 0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = decisionColor;
      ctx.textAlign = "center";
      ctx.fillText(decisionText, w / 2, badgeY + badgeFS + 4);

      // Ball speed underneath
      ctx.font = `bold ${badgeFS * 0.5}px ui-monospace, monospace`;
      ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
      ctx.fillText(`${trajectory.ballSpeed} km/h`, w / 2, badgeY + badgeFS + badgePad + badgeFS * 0.7);

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
        // Increment based on 5-second total duration
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
