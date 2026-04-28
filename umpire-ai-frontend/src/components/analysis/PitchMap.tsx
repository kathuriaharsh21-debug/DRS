import { useRef, useEffect, useCallback } from 'react';
import {
  PITCH_LENGTH_M,
  PITCH_WIDTH_M,
  CREASE_LENGTH_M,
  POPPING_CREASE_WIDTH_M,
  COLORS,
} from '../../lib/constants';
import type { TrajectoryData, TrajectoryPoint, BouncePoint, PredictedPathPoint } from '../../types';

interface PitchMapProps {
  trajectory: TrajectoryData;
  className?: string;
  /** v2: bounce points to overlay on the pitch */
  bouncePoints?: BouncePoint[];
  /** v2: physics-predicted future path */
  predictedPath?: PredictedPathPoint[];
}

export function PitchMap({ trajectory, className = '', bouncePoints = [], predictedPath = [] }: PitchMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const container = canvas.parentElement;
    if (!container) return;

    const containerW = container.clientWidth;
    const containerH = Math.max(300, containerW * 0.6);

    canvas.width = containerW * dpr;
    canvas.height = containerH * dpr;
    canvas.style.width = `${containerW}px`;
    canvas.style.height = `${containerH}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    // Calculate pitch drawing area
    const padding = 50;
    const pitchDrawW = containerW - padding * 2;
    const pitchDrawH = containerH - padding * 2;

    // Scale to fit pitch dimensions (longer axis fills)
    const scaleX = pitchDrawW / (PITCH_LENGTH_M + 4);
    const scaleY = pitchDrawH / (PITCH_WIDTH_M + 2);
    const scale = Math.min(scaleX, scaleY);

    const pitchW = PITCH_LENGTH_M * scale;
    const pitchH = PITCH_WIDTH_M * scale;
    const offsetX = (containerW - pitchW) / 2;
    const offsetY = (containerH - pitchH) / 2;

    // Draw background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, containerW, containerH);

    // Draw outfield gradient
    const outfieldGrad = ctx.createRadialGradient(
      containerW / 2, containerH / 2, 0,
      containerW / 2, containerH / 2, containerW / 1.5,
    );
    outfieldGrad.addColorStop(0, 'rgba(26, 92, 53, 0.2)');
    outfieldGrad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    ctx.fillStyle = outfieldGrad;
    ctx.fillRect(0, 0, containerW, containerH);

    // Draw pitch surface
    const pitchGrad = ctx.createLinearGradient(offsetX, offsetY, offsetX, offsetY + pitchH);
    pitchGrad.addColorStop(0, COLORS.pitchSurface);
    pitchGrad.addColorStop(0.5, '#1f6b3d');
    pitchGrad.addColorStop(1, COLORS.pitchSurface);
    ctx.fillStyle = pitchGrad;
    ctx.fillRect(offsetX, offsetY, pitchW, pitchH);

    // Pitch border
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(offsetX, offsetY, pitchW, pitchH);

    // Draw creases
    ctx.strokeStyle = COLORS.crease;
    ctx.lineWidth = 2;

    // Bowling crease (top)
    const creaseW = POPPING_CREASE_WIDTH_M * scale;
    ctx.beginPath();
    ctx.moveTo(offsetX - creaseW, offsetY);
    ctx.lineTo(offsetX, offsetY);
    ctx.stroke();

    // Return creases at bowling end
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY);
    ctx.lineTo(offsetX, offsetY - creaseW);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY + pitchH);
    ctx.lineTo(offsetX, offsetY + pitchH + creaseW);
    ctx.stroke();
    ctx.setLineDash([]);

    // Batting crease (bottom)
    ctx.strokeStyle = COLORS.crease;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(offsetX + pitchW, offsetY);
    ctx.lineTo(offsetX + pitchW + creaseW, offsetY);
    ctx.stroke();

    // Return creases at batting end
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(offsetX + pitchW, offsetY);
    ctx.lineTo(offsetX + pitchW, offsetY - creaseW);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(offsetX + pitchW, offsetY + pitchH);
    ctx.lineTo(offsetX + pitchW, offsetY + pitchH + creaseW);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw stumps
    drawStumps(ctx, offsetX, offsetY + pitchH / 2, scale, true);
    drawStumps(ctx, offsetX + pitchW, offsetY + pitchH / 2, scale, false);

    // Draw batsman
    const batsmanX = offsetX + pitchW - 1 * scale;
    const batsmanY = offsetY + pitchH / 2;
    ctx.beginPath();
    ctx.arc(batsmanX, batsmanY, 4 * scale, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(96, 165, 250, 0.6)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.8)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = 'rgba(96, 165, 250, 0.5)';
    ctx.font = `${Math.max(9, 10 * scale)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('BAT', batsmanX, batsmanY + 4 * scale + 12 * scale);

    // Draw trajectory
    if (trajectory.points.length >= 2) {
      drawTrajectory(ctx, trajectory.points, scale, offsetX, offsetY, pitchH);
    }

    // Draw pitch point
    if (trajectory.pitch_point) {
      const px = offsetX + trajectory.pitch_point.x * scale;
      const py = offsetY + pitchH / 2 + trajectory.pitch_point.y * scale;
      drawPitchMark(ctx, px, py, scale);
    }

    // Draw impact point
    if (trajectory.impact_point) {
      const ix = offsetX + trajectory.impact_point.x * scale;
      const iy = offsetY + pitchH / 2 + trajectory.impact_point.y * scale;
      drawImpactMark(ctx, ix, iy, scale);
    }

    // v2: Draw bounce points on the pitch map
    const allBounces = bouncePoints.length > 0
      ? bouncePoints
      : trajectory.bounce_points || [];

    if (allBounces.length > 0) {
      for (const bp of allBounces) {
        const bx = offsetX + bp.x * scale;
        const by = offsetY + pitchH / 2 + bp.y * scale;
        drawBouncePointOnPitch(ctx, bx, by, scale);
      }
    }

    // v2: Draw predicted future path on pitch map
    if (predictedPath.length > 0 && trajectory.impact_point) {
      const impactX = offsetX + trajectory.impact_point.x * scale;
      const impactY = offsetY + pitchH / 2 + trajectory.impact_point.y * scale;
      drawPredictedPathOnPitch(ctx, impactX, impactY, predictedPath, scale, offsetX + pitchW);
    }

    // Draw predicted path (wicket zone)
    if (trajectory.predicted_path === 'HITTING') {
      ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
      const stumpW = 3 * scale;
      const stumpH = 12 * scale;
      ctx.fillRect(
        offsetX + pitchW - stumpW / 2,
        offsetY + pitchH / 2 - stumpH / 2,
        stumpW,
        stumpH,
      );
    }

    // Labels
    ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
    ctx.font = `${Math.max(10, 11 * scale)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText('BOWLING END', offsetX, offsetY - creaseW - 8 * scale);
    ctx.fillText('BATTING END', offsetX + pitchW, offsetY - creaseW - 8 * scale);

    // Deviation indicator
    if (trajectory.deviation_degrees !== 0) {
      drawDeviation(ctx, trajectory.deviation_degrees, containerW, containerH);
    }

    ctx.restore();
  }, [trajectory, bouncePoints, predictedPath]);

  useEffect(() => {
    draw();
    const observer = new ResizeObserver(draw);
    if (canvasRef.current?.parentElement) {
      observer.observe(canvasRef.current.parentElement);
    }
    return () => observer.disconnect();
  }, [draw]);

  return (
    <div className={`w-full ${className}`}>
      <canvas ref={canvasRef} className="w-full rounded-lg" />
    </div>
  );
}

// ─── Drawing Helpers ───────────────────────────────────────

function drawStumps(
  ctx: CanvasRenderingContext2D,
  x: number,
  centerY: number,
  scale: number,
  _isBowlingEnd: boolean,
) {
  const stumpW = 2 * scale;
  const stumpH = 8 * scale;
  const spacing = 3 * scale;

  ctx.fillStyle = COLORS.stumps;
  ctx.globalAlpha = 0.7;
  for (let i = -1; i <= 1; i++) {
    const sx = x + i * spacing - stumpW / 2;
    ctx.fillRect(sx, centerY - stumpH / 2, stumpW, stumpH);
  }

  ctx.fillRect(x - spacing - stumpW / 2, centerY - stumpH / 2 - 1 * scale, spacing * 2 + stumpW, 1 * scale);
  ctx.fillRect(x - spacing - stumpW / 2, centerY + stumpH / 2, spacing * 2 + stumpW, 1 * scale);
  ctx.globalAlpha = 1;
}

function drawTrajectory(
  ctx: CanvasRenderingContext2D,
  points: TrajectoryPoint[],
  scale: number,
  offsetX: number,
  offsetY: number,
  pitchH: number,
) {
  if (points.length < 2) return;

  ctx.beginPath();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = COLORS.trajectoryAmber;
  ctx.lineWidth = 2;

  for (let i = 0; i < points.length; i++) {
    const px = offsetX + points[i].x * scale;
    const py = offsetY + pitchH / 2 + points[i].y * scale;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawPitchMark(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 12 * scale);
  glow.addColorStop(0, 'rgba(52, 211, 153, 0.3)');
  glow.addColorStop(1, 'rgba(52, 211, 153, 0)');
  ctx.beginPath();
  ctx.arc(x, y, 12 * scale, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x, y, 5 * scale, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.pitchMark;
  ctx.fill();

  ctx.strokeStyle = COLORS.pitchMark;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 8 * scale, y);
  ctx.lineTo(x + 8 * scale, y);
  ctx.moveTo(x, y - 8 * scale);
  ctx.lineTo(x, y + 8 * scale);
  ctx.stroke();

  ctx.fillStyle = COLORS.pitchMark;
  ctx.font = `bold ${Math.max(9, 10 * scale)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('PITCH', x, y - 10 * scale);
}

function drawImpactMark(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number) {
  const size = 6 * scale;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
  ctx.fillStyle = COLORS.impactMark;
  ctx.fill();
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = COLORS.impactMark;
  ctx.font = `bold ${Math.max(9, 10 * scale)}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('IMPACT', x, y - size - 6 * scale);
}

// ─── v2: Bounce point on pitch map ─────────────────────────

function drawBouncePointOnPitch(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
) {
  // Orange concentric circles for bounce
  const radius = 6 * scale;

  // Outer ring
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(251, 146, 60, 0.6)'; // orange-400
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Inner filled dot
  ctx.beginPath();
  ctx.arc(x, y, 2.5 * scale, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(251, 146, 60, 0.8)';
  ctx.fill();

  // Label
  ctx.font = `bold ${Math.max(8, 9 * scale)}px monospace`;
  ctx.fillStyle = 'rgba(251, 146, 60, 0.7)';
  ctx.textAlign = 'center';
  ctx.fillText('BOUNCE', x, y - radius - 4 * scale);
}

// ─── v2: Predicted future path on pitch map ────────────────

function drawPredictedPathOnPitch(
  ctx: CanvasRenderingContext2D,
  startX: number,
  startY: number,
  predictedPath: PredictedPathPoint[],
  scale: number,
  battingEndX: number,
) {
  if (predictedPath.length === 0) return;

  // Draw dashed cyan line from impact point toward stumps
  ctx.beginPath();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.5)'; // cyan
  ctx.lineWidth = 1.5;

  const totalSteps = Math.min(predictedPath.length, 12);
  const totalDist = battingEndX - startX;

  for (let i = 0; i < totalSteps; i++) {
    const pp = predictedPath[i];
    const progress = (i + 1) / totalSteps;
    const px = startX + totalDist * progress;
    // Use the predicted path's lateral deviation
    const lateralOffset = (pp.x - predictedPath[0].x) * scale * 50;
    const py = startY + lateralOffset;

    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);

    // Small dot at each step
    ctx.save();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(px, py, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(34, 211, 238, 0.5)';
    ctx.fill();
    ctx.setLineDash([3, 3]);
    ctx.restore();
  }

  ctx.stroke();
  ctx.setLineDash([]);

  // "PREDICTED" label at the end
  if (totalSteps > 0) {
    const lastPP = predictedPath[totalSteps - 1];
    const endX = startX + totalDist;
    const endY = startY + (lastPP.x - predictedPath[0].x) * scale * 50;

    ctx.font = `${Math.max(8, 9 * scale)}px monospace`;
    ctx.fillStyle = 'rgba(34, 211, 238, 0.5)';
    ctx.textAlign = 'center';
    ctx.fillText('PREDICTED PATH', (startX + endX) / 2, endY - 10 * scale);
  }
}

function drawDeviation(
  ctx: CanvasRenderingContext2D,
  degrees: number,
  containerW: number,
  containerH: number,
) {
  const x = containerW - 80;
  const y = containerH - 40;

  ctx.save();
  ctx.translate(x, y);

  // Background
  ctx.fillStyle = 'rgba(15, 23, 42, 0.8)';
  ctx.beginPath();
  const rr = 6;
  ctx.moveTo(-35 + rr, -20);
  ctx.lineTo(35 - rr, -20);
  ctx.arcTo(35, -20, 35, -20 + rr, rr);
  ctx.lineTo(35, 20 - rr);
  ctx.arcTo(35, 20, 35 - rr, 20, rr);
  ctx.lineTo(-35 + rr, 20);
  ctx.arcTo(-35, 20, -35, 20 - rr, rr);
  ctx.lineTo(-35, -20 + rr);
  ctx.arcTo(-35, -20, -35 + rr, -20, rr);
  ctx.fill();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();

  const angle = (degrees * Math.PI) / 180;
  ctx.rotate(angle);

  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-12, 0);
  ctx.lineTo(12, 0);
  ctx.lineTo(8, -4);
  ctx.moveTo(12, 0);
  ctx.lineTo(8, 4);
  ctx.stroke();

  ctx.restore();

  ctx.fillStyle = 'rgba(148, 163, 184, 0.6)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${degrees.toFixed(1)}°`, x, y + 26);
}
