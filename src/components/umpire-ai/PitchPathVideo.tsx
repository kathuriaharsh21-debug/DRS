'use client'

import React, { useRef, useEffect, useState, useCallback } from "react";
import type { AnalysisResult } from "@/lib/types";

interface PitchPathVideoProps {
  analysisResult: AnalysisResult;
  isPlaying: boolean;
  playbackSpeed: number;
  onProgress?: (progress: number) => void;
}

// Physical pitch constants (feet)
const PITCH_LENGTH = 66.0;
const PITCH_WIDTH = 10.0;
const STUMP_HEIGHT = 2.333;
const STUMP_SPREAD = 0.75;
const STUMP_THICKNESS = 0.18;
const BAIL_LENGTH = 0.5;
const POPPING_CREASE_DIST = 4;

// Camera constants
const CAM_ELEVATION = 28;
const CAM_AZIMUTH = 10;
const CAM_DISTANCE = 85;
const CAM_HEIGHT_FEET = 32;
const FOCAL_LENGTH = 450;

// Animation
const ANIM_DURATION_MS = 5000;
const FADE_IN_END = 0.15;

function worldFromPitch(pitchX: number, pitchY: number, pitchZ: number) {
  return { x: pitchX, y: pitchY - PITCH_LENGTH / 2, z: pitchZ };
}

function project(
  wx: number, wy: number, wz: number,
  cx: number, cy: number, flip: number,
) {
  const azRad = (CAM_AZIMUTH * Math.PI) / 180;
  const camX = CAM_DISTANCE * Math.sin(azRad);
  const camY = -CAM_DISTANCE * Math.cos(azRad);
  const camZ = CAM_HEIGHT_FEET;
  const lookX = 0, lookY = 5, lookZ = 0;
  const forward = { x: lookX - camX, y: lookY - camY, z: lookZ - camZ };
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
  const dx = wx - camX, dy = wy - camY, dz = wz - camZ;
  const camSpaceX = dx * right.x + dy * right.y + dz * right.z;
  const camSpaceY = dx * up.x + dy * up.y + dz * up.z;
  const camSpaceZ = dx * fwd.x + dy * fwd.y + dz * fwd.z;
  if (camSpaceZ <= 0.5) return null;
  return {
    x: cx + flip * (FOCAL_LENGTH * camSpaceX) / camSpaceZ,
    y: cy - (FOCAL_LENGTH * camSpaceY) / camSpaceZ,
    scale: FOCAL_LENGTH / camSpaceZ,
  };
}

function drawLine3D(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  cx: number, cy: number, flip: number,
  style: string, width: number = 1,
) {
  const w1 = worldFromPitch(x1, y1, z1);
  const w2 = worldFromPitch(x2, y2, z2);
  const a = project(w1.x, w1.y, w1.z, cx, cy, flip);
  const b = project(w2.x, w2.y, w2.z, cx, cy, flip);
  if (!a || !b) return;
  ctx.save();
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function drawStumpSet(
  ctx: CanvasRenderingContext2D,
  pitchY: number,
  cx: number, cy: number, flip: number,
  color: string, alpha: number = 1.0,
) {
  const positions = [-STUMP_SPREAD, 0, STUMP_SPREAD];
  const top = STUMP_HEIGHT;
  const stumpscaleMult = 1.8;

  for (const sx of positions) {
    const wBot = worldFromPitch(sx, pitchY, 0);
    const wTop = worldFromPitch(sx, pitchY, top);
    const bot = project(wBot.x, wBot.y, wBot.z, cx, cy, flip);
    const tp = project(wTop.x, wTop.y, wTop.z, cx, cy, flip);
    if (!bot || !tp) continue;
    const lineW = Math.max(3, 8 * bot.scale * stumpscaleMult);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineW;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(bot.x, bot.y);
    ctx.lineTo(tp.x, tp.y);
    ctx.stroke();
    // Stump highlight edge
    ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
    ctx.lineWidth = lineW * 0.4;
    ctx.beginPath();
    ctx.moveTo(bot.x - lineW * 0.15, bot.y);
    ctx.lineTo(tp.x - lineW * 0.15, tp.y);
    ctx.stroke();
    ctx.restore();
  }

  for (let i = 0; i < 2; i++) {
    const sx1 = positions[i], sx2 = positions[i + 1];
    const ext = BAIL_LENGTH * 0.35;
    const w1 = worldFromPitch(sx1 - ext, pitchY, top);
    const w2 = worldFromPitch(sx2 + ext, pitchY, top);
    const p1 = project(w1.x, w1.y, w1.z, cx, cy, flip);
    const p2 = project(w2.x, w2.y, w2.z, cx, cy, flip);
    if (!p1 || !p2) continue;
    const bailW = Math.max(2, 5 * p1.scale * stumpscaleMult);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = bailW;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = bailW * 0.35;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y - bailW * 0.2);
    ctx.lineTo(p2.x, p2.y - bailW * 0.2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawPitchSurface(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, flip: number,
  fadeAlpha: number = 1.0,
) {
  const hw = PITCH_WIDTH / 2;
  const corners3D = [
    worldFromPitch(-hw, 0, 0),
    worldFromPitch(hw, 0, 0),
    worldFromPitch(hw, PITCH_LENGTH, 0),
    worldFromPitch(-hw, PITCH_LENGTH, 0),
  ];
  const corners = corners3D.map(c => project(c.x, c.y, c.z, cx, cy, flip));
  if (!corners.every(Boolean)) return;
  const pts = corners.filter(Boolean) as { x: number; y: number }[];

  ctx.save();
  ctx.globalAlpha = fadeAlpha;

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

  // Subtle mowed grass stripes
  const stripeCount = 20;
  for (let i = 0; i < stripeCount; i++) {
    const y1 = (i / stripeCount) * PITCH_LENGTH;
    const y2 = ((i + 1) / stripeCount) * PITCH_LENGTH;
    const s1L = worldFromPitch(-hw, y1, 0);
    const s1R = worldFromPitch(hw, y1, 0);
    const s2L = worldFromPitch(-hw, y2, 0);
    const s2R = worldFromPitch(hw, y2, 0);
    const p1L = project(s1L.x, s1L.y, s1L.z, cx, cy, flip);
    const p1R = project(s1R.x, s1R.y, s1R.z, cx, cy, flip);
    const p2L = project(s2L.x, s2L.y, s2L.z, cx, cy, flip);
    const p2R = project(s2R.x, s2R.y, s2R.z, cx, cy, flip);
    if (p1L && p1R && p2L && p2R) {
      ctx.fillStyle = i % 2 === 0 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.03)";
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
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function drawSlimPath(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
  coreColor: string,
  glowColor: string,
  coreWidth: number = 2,
  glowWidth: number = 6,
) {
  if (points.length < 2) return;
  // Glow layer
  ctx.save();
  ctx.strokeStyle = glowColor;
  ctx.lineWidth = glowWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
  ctx.restore();
  // Core line
  ctx.save();
  ctx.strokeStyle = coreColor;
  ctx.lineWidth = coreWidth;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();
  ctx.restore();
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
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

  const normToPitch = useCallback((nx: number, ny: number, t: number = 0) => {
    const pitchX = (nx - 0.5) * 6;
    const pitchY = ny * PITCH_LENGTH;
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
    const cy = h * 0.48;
    const flip = -1;

    const { trajectory, frameData } = analysisResult;
    const totalPoints = frameData.length;

    // Background
    const bgGrad = ctx.createRadialGradient(cx, cy * 0.9, 0, cx, cy, w * 0.8);
    bgGrad.addColorStop(0, "#0d1f0d");
    bgGrad.addColorStop(0.3, "#0a1a0a");
    bgGrad.addColorStop(0.6, "#071207");
    bgGrad.addColorStop(1, "#040c04");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Fade-in alpha
    const setupAlpha = progress < FADE_IN_END
      ? easeOutCubic(progress / FADE_IN_END) : 1.0;

    // Pitch surface
    drawPitchSurface(ctx, cx, cy, flip, setupAlpha);

    // Crease lines
    ctx.save();
    ctx.globalAlpha = setupAlpha;
    const creaseHW = PITCH_WIDTH / 2 + 3;
    const line = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, style: string, width: number) =>
      drawLine3D(ctx, x1, y1, z1, x2, y2, z2, cx, cy, flip, style, width);
    // Bowling crease
    line(-creaseHW, 0, 0, creaseHW, 0, 0, "rgba(255,255,255,0.75)", 2);
    // Bowling popping crease
    line(-creaseHW, POPPING_CREASE_DIST, 0, creaseHW, POPPING_CREASE_DIST, 0, "rgba(255,255,255,0.5)", 1.5);
    // Bowling return creases
    line(-creaseHW, -4, 0, -creaseHW, POPPING_CREASE_DIST, 0, "rgba(255,255,255,0.3)", 1.2);
    line(creaseHW, -4, 0, creaseHW, POPPING_CREASE_DIST, 0, "rgba(255,255,255,0.3)", 1.2);
    // Batting crease
    line(-creaseHW, PITCH_LENGTH, 0, creaseHW, PITCH_LENGTH, 0, "rgba(255,255,255,0.65)", 2);
    // Batting popping crease
    line(-creaseHW, PITCH_LENGTH - POPPING_CREASE_DIST, 0, creaseHW, PITCH_LENGTH - POPPING_CREASE_DIST, 0, "rgba(255,255,255,0.45)", 1.5);
    // Batting return creases
    line(-creaseHW, PITCH_LENGTH, 0, -creaseHW, PITCH_LENGTH + 4, 0, "rgba(255,255,255,0.25)", 1.2);
    line(creaseHW, PITCH_LENGTH, 0, creaseHW, PITCH_LENGTH + 4, 0, "rgba(255,255,255,0.25)", 1.2);
    ctx.restore();

    // Bowling end stumps
    ctx.save();
    ctx.globalAlpha = setupAlpha;
    drawStumpSet(ctx, 0, cx, cy, flip, "#F0E8D8", 0.9);
    ctx.restore();

    // Batting end stumps (no highlight)
    ctx.save();
    ctx.globalAlpha = setupAlpha;
    drawStumpSet(ctx, PITCH_LENGTH, cx, cy, flip, "#F0E8D8", 0.85);
    ctx.restore();

    // Trajectory paths — ALL points shown after fade-in
    if (totalPoints < 2) return;

    // Project all tracked trajectory points
    const screenPoints: { x: number; y: number }[] = [];
    for (let i = 0; i < totalPoints; i++) {
      const fd = frameData[i];
      const t = i / Math.max(totalPoints - 1, 1);
      const pitch = normToPitch(fd.x, fd.y, t);
      const world = worldFromPitch(pitch.pitchX, pitch.pitchY, pitch.pitchZ);
      const sp = project(world.x, world.y, world.z, cx, cy, flip);
      if (sp) screenPoints.push(sp);
    }

    // Tracked path — slim red
    if (screenPoints.length >= 2) {
      ctx.save();
      ctx.globalAlpha = setupAlpha;
      drawSlimPath(ctx, screenPoints, "#FF0000", "rgba(255,0,0,0.3)", 2, 6);
      ctx.restore();
    }

    // Predicted path — slim blue
    if (trajectory.predictedPathPoints.length > 0 && screenPoints.length > 0) {
      const lastScreen = screenPoints[screenPoints.length - 1];
      const predPoints: { x: number; y: number }[] = [lastScreen];
      for (let i = 0; i < trajectory.predictedPathPoints.length; i++) {
        const pp = trajectory.predictedPathPoints[i];
        const t = i / Math.max(trajectory.predictedPathPoints.length - 1, 1);
        const pitchZ = Math.max(0, 2.5 * (1 - t * 1.3));
        const pitchX = (pp.x - 0.5) * 6;
        const pitchY = pp.y * PITCH_LENGTH;
        const world = worldFromPitch(pitchX, pitchY, pitchZ);
        const sp = project(world.x, world.y, world.z, cx, cy, flip);
        if (sp) predPoints.push(sp);
      }
      if (predPoints.length > 1) {
        ctx.save();
        ctx.globalAlpha = setupAlpha;
        drawSlimPath(ctx, predPoints, "#0066FF", "rgba(0,102,255,0.3)", 2, 6);
        ctx.restore();
      }
    }
  }, [analysisResult, normToPitch]);

  useEffect(() => {
    let stopped = false;
    const animate = (timestamp: number) => {
      if (stopped) return;
      const w = dimensions.width, h = dimensions.height;
      if (w === 0 || h === 0) {
        animFrameRef.current = requestAnimationFrame(animate);
        return;
      }
      if (lastTimeRef.current === 0) lastTimeRef.current = timestamp;
      const deltaMs = timestamp - lastTimeRef.current;
      lastTimeRef.current = timestamp;
      if (isPlayingRef.current) {
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
    return () => { stopped = true; cancelAnimationFrame(animFrameRef.current); };
  }, [dimensions, drawScene, onProgress]);

  useEffect(() => {
    progressRef.current = 0;
    lastTimeRef.current = 0;
  }, [analysisResult]);

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas
        ref={canvasRef}
        style={{ width: dimensions.width || "100%", height: dimensions.height || "100%" }}
        className="w-full h-full rounded-xl"
      />
    </div>
  );
}
