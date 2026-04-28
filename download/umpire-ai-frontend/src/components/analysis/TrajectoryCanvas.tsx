import { useRef, useEffect, useCallback } from 'react';
import type { TrajectoryPoint, BouncePoint, PredictedPathPoint } from '../../types';

interface TrajectoryCanvasProps {
  points: TrajectoryPoint[];
  currentBallPosition: { x: number; y: number } | null;
  width: number;
  height: number;
  containerRef: React.RefObject<HTMLVideoElement | null>;
  currentFrame: number;
  totalFrames: number;
  /** v2: bounce points detected in trajectory */
  bouncePoints?: BouncePoint[];
  /** v2: physics-predicted future path */
  predictedPath?: PredictedPathPoint[];
  /** v2: frame numbers that correspond to bounce events */
  bounceFrameNumbers?: number[];
}

export function TrajectoryCanvas({
  points,
  currentBallPosition,
  width: _width,
  height: _height,
  containerRef,
  currentFrame,
  totalFrames,
  bouncePoints = [],
  predictedPath = [],
  bounceFrameNumbers = [],
}: TrajectoryCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const video = containerRef.current;
    if (!canvas || !video) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = video.getBoundingClientRect();

    // Resize canvas to match video
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    // Normalize video dimensions (use natural size if available)
    const vw = video.videoWidth || rect.width;
    const vh = video.videoHeight || rect.height;
    const scaleX = rect.width / vw;
    const scaleY = rect.height / vh;

    // Draw stumps at right side (batting end)
    drawStumps(ctx, rect.width, rect.height, scaleX, scaleY);

    if (points.length === 0) {
      ctx.restore();
      return;
    }

    // Draw trajectory path
    drawTrajectoryPath(ctx, points, scaleX, scaleY, rect.width, rect.height);

    // Draw v2 predicted future path (dashed cyan line)
    if (predictedPath.length > 0 && points.length > 2) {
      drawPredictedPath(ctx, points, predictedPath, scaleX, scaleY);
    }

    // Draw v2 bounce points (orange markers)
    if (bouncePoints.length > 0) {
      drawBounceMarkers(ctx, bouncePoints, scaleX, scaleY);
    } else if (bounceFrameNumbers.length > 0) {
      // Alternative: mark bounces by frame number in trajectory
      drawBouncesByFrame(ctx, points, bounceFrameNumbers, scaleX, scaleY);
    }

    // Draw current ball position
    if (currentBallPosition) {
      const bx = currentBallPosition.x * scaleX;
      const by = currentBallPosition.y * scaleY;
      drawBall(ctx, bx, by);

      // Highlight if current frame is a bounce frame
      if (bounceFrameNumbers.includes(currentFrame)) {
        drawBounceRing(ctx, bx, by);
      }
    }

    // Draw progress indicator
    if (totalFrames > 0) {
      const progress = currentFrame / totalFrames;
      ctx.fillStyle = 'rgba(52, 211, 153, 0.15)';
      ctx.fillRect(0, 0, rect.width * progress, 3);
    }

    // v2: Draw tier badge in top-left
    ctx.font = '10px monospace';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.5)';
    ctx.fillText('Umpire AI v2', 8, 16);

    ctx.restore();
  }, [points, currentBallPosition, containerRef, currentFrame, totalFrames, bouncePoints, predictedPath, bounceFrameNumbers]);

  // Draw loop for smooth animation
  useEffect(() => {
    const tick = () => {
      draw();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [draw]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    const video = containerRef.current;
    if (!canvas || !video) return;

    const resizeObserver = new ResizeObserver(() => {
      draw();
    });

    resizeObserver.observe(video);
    return () => resizeObserver.disconnect();
  }, [containerRef, draw]);

  return (
    <canvas
      ref={canvasRef}
      className="trajectory-canvas"
    />
  );
}

// ─── Drawing Helpers ───────────────────────────────────────

function drawStumps(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  scaleX: number,
  _scaleY: number,
) {
  const stumpWidth = 5 * scaleX;
  const stumpHeight = 60 * scaleX;
  const stumpSpacing = 14 * scaleX;
  const stumpX = canvasW - 30 * scaleX;
  const stumpY = (canvasH - stumpHeight) / 2;

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = Math.max(1, stumpWidth * 0.5);
  ctx.lineCap = 'round';

  for (let i = -1; i <= 1; i++) {
    const x = stumpX + i * stumpSpacing;
    ctx.beginPath();
    ctx.moveTo(x, stumpY);
    ctx.lineTo(x, stumpY + stumpHeight);
    ctx.stroke();
  }

  ctx.lineWidth = Math.max(1, stumpWidth * 0.35);
  ctx.strokeStyle = '#cbd5e1';
  for (let i = 0; i < 2; i++) {
    const y = stumpY + (i === 0 ? -2 : stumpHeight + 2) * scaleX;
    ctx.beginPath();
    ctx.moveTo(stumpX - stumpSpacing, y);
    ctx.lineTo(stumpX + stumpSpacing, y);
    ctx.stroke();
  }
}

function drawTrajectoryPath(
  ctx: CanvasRenderingContext2D,
  points: TrajectoryPoint[],
  scaleX: number,
  scaleY: number,
  _canvasW: number,
  _canvasH: number,
) {
  if (points.length < 2) return;

  const gradient = ctx.createLinearGradient(
    points[0].x * scaleX,
    points[0].y * scaleY,
    points[points.length - 1].x * scaleX,
    points[points.length - 1].y * scaleY,
  );
  gradient.addColorStop(0, '#34d399');
  gradient.addColorStop(0.5, '#fbbf24');
  gradient.addColorStop(1, '#ef4444');

  // Glow layer
  ctx.beginPath();
  ctx.moveTo(points[0].x * scaleX, points[0].y * scaleY);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x * scaleX, points[i].y * scaleY);
  }
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.15)';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Main trajectory line
  ctx.beginPath();
  ctx.moveTo(points[0].x * scaleX, points[0].y * scaleY);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x * scaleX, points[i].y * scaleY);
  }
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Small dots at each point
  for (let i = 0; i < points.length; i++) {
    const px = points[i].x * scaleX;
    const py = points[i].y * scaleY;
    ctx.beginPath();
    ctx.arc(px, py, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(251, 191, 36, 0.4)';
    ctx.fill();
  }
}

// ─── v2: Predicted future path ─────────────────────────────

function drawPredictedPath(
  ctx: CanvasRenderingContext2D,
  trajectoryPoints: TrajectoryPoint[],
  predictedPath: PredictedPathPoint[],
  scaleX: number,
  scaleY: number,
) {
  if (trajectoryPoints.length < 2 || predictedPath.length === 0) return;

  // Start from the last trajectory point
  const lastPoint = trajectoryPoints[trajectoryPoints.length - 1];
  const startX = lastPoint.x * scaleX;
  const startY = lastPoint.y * scaleY;

  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.7)'; // cyan for predicted
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  ctx.moveTo(startX, startY);

  for (let i = 0; i < Math.min(predictedPath.length, 15); i++) {
    const pp = predictedPath[i];
    // Offset from last trajectory point, scaled
    const px = startX + pp.x * (i + 1) * 20;
    const py = startY + pp.y * (i + 1) * 20;
    ctx.lineTo(px, py);

    // Draw step number
    if (i % 3 === 0) {
      ctx.save();
      ctx.setLineDash([]);
      ctx.font = '8px monospace';
      ctx.fillStyle = 'rgba(34, 211, 238, 0.5)';
      ctx.fillText(`${i + 1}`, px + 4, py - 4);
      ctx.setLineDash([4, 4]);
      ctx.restore();
    }
  }

  ctx.stroke();
  ctx.setLineDash([]);

  // Label
  ctx.font = '9px monospace';
  ctx.fillStyle = 'rgba(34, 211, 238, 0.6)';
  if (predictedPath.length > 0) {
    const lastPP = predictedPath[Math.min(predictedPath.length - 1, 14)];
    const labelX = startX + lastPP.x * 15 * 20;
    const labelY = startY + lastPP.y * 15 * 20;
    ctx.fillText('PREDICTED', labelX + 6, labelY);
  }
}

// ─── v2: Bounce markers ────────────────────────────────────

function drawBounceMarkers(
  ctx: CanvasRenderingContext2D,
  bouncePoints: BouncePoint[],
  scaleX: number,
  scaleY: number,
) {
  for (const bp of bouncePoints) {
    const bx = bp.x * scaleX;
    const by = bp.y * scaleY;
    drawBounceRing(ctx, bx, by);

    // Label
    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = 'rgba(251, 146, 60, 0.8)'; // orange-400
    ctx.textAlign = 'left';
    ctx.fillText('PITCH', bx + 14, by + 3);
  }
}

function drawBouncesByFrame(
  ctx: CanvasRenderingContext2D,
  trajectoryPoints: TrajectoryPoint[],
  bounceFrameNumbers: number[],
  scaleX: number,
  scaleY: number,
) {
  const bounceSet = new Set(bounceFrameNumbers);
  for (const pt of trajectoryPoints) {
    if (bounceSet.has(pt.frame_number)) {
      const bx = pt.x * scaleX;
      const by = pt.y * scaleY;
      drawBounceRing(ctx, bx, by);
    }
  }
}

function drawBounceRing(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Orange ring for bounce
  const ringRadius = 14;
  ctx.beginPath();
  ctx.arc(x, y, ringRadius, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(251, 146, 60, 0.7)'; // orange-400
  ctx.lineWidth = 2;
  ctx.stroke();

  // Small inner dot
  ctx.beginPath();
  ctx.arc(x, y, 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(251, 146, 60, 0.8)';
  ctx.fill();
}

function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number) {
  // Outer glow
  const glowGrad = ctx.createRadialGradient(x, y, 0, x, y, 20);
  glowGrad.addColorStop(0, 'rgba(251, 191, 36, 0.4)');
  glowGrad.addColorStop(0.5, 'rgba(251, 191, 36, 0.1)');
  glowGrad.addColorStop(1, 'rgba(251, 191, 36, 0)');
  ctx.beginPath();
  ctx.arc(x, y, 20, 0, Math.PI * 2);
  ctx.fillStyle = glowGrad;
  ctx.fill();

  // Ball circle
  const ballGrad = ctx.createRadialGradient(x - 2, y - 2, 0, x, y, 8);
  ballGrad.addColorStop(0, '#fde68a');
  ballGrad.addColorStop(0.5, '#f59e0b');
  ballGrad.addColorStop(1, '#d97706');
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fillStyle = ballGrad;
  ctx.fill();

  // White highlight
  ctx.beginPath();
  ctx.arc(x - 2, y - 2, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fill();

  // Crosshair
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.6)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x - 15, y);
  ctx.lineTo(x + 15, y);
  ctx.moveTo(x, y - 15);
  ctx.lineTo(x, y + 15);
  ctx.stroke();
  ctx.setLineDash([]);
}
