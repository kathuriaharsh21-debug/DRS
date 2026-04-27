import { useRef, useEffect, useCallback } from 'react';
import type { TrajectoryPoint } from '../../types';

interface TrajectoryCanvasProps {
  points: TrajectoryPoint[];
  currentBallPosition: { x: number; y: number } | null;
  width: number;
  height: number;
  containerRef: React.RefObject<HTMLVideoElement | null>;
  currentFrame: number;
  totalFrames: number;
}

export function TrajectoryCanvas({
  points,
  currentBallPosition,
  width: _width,
  height: _height,
  containerRef,
  currentFrame,
  totalFrames,
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

    // Draw current ball position
    if (currentBallPosition) {
      const bx = currentBallPosition.x * scaleX;
      const by = currentBallPosition.y * scaleY;
      drawBall(ctx, bx, by);
    }

    // Draw progress indicator
    if (totalFrames > 0) {
      const progress = currentFrame / totalFrames;
      ctx.fillStyle = 'rgba(52, 211, 153, 0.15)';
      ctx.fillRect(0, 0, rect.width * progress, 3);
    }

    ctx.restore();
  }, [points, currentBallPosition, containerRef, currentFrame, totalFrames]);

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

  // Three stumps
  for (let i = -1; i <= 1; i++) {
    const x = stumpX + i * stumpSpacing;
    ctx.beginPath();
    ctx.moveTo(x, stumpY);
    ctx.lineTo(x, stumpY + stumpHeight);
    ctx.stroke();
  }

  // Bails (horizontal lines connecting stumps)
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

  // Create gradient along the path (green → amber → red)
  const gradient = ctx.createLinearGradient(
    points[0].x * scaleX,
    points[0].y * scaleY,
    points[points.length - 1].x * scaleX,
    points[points.length - 1].y * scaleY,
  );
  gradient.addColorStop(0, '#34d399');
  gradient.addColorStop(0.5, '#fbbf24');
  gradient.addColorStop(1, '#ef4444');

  // Draw glow layer
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

  // Draw main trajectory line
  ctx.beginPath();
  ctx.moveTo(points[0].x * scaleX, points[0].y * scaleY);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x * scaleX, points[i].y * scaleY);
  }
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Draw small dots at each trajectory point
  for (let i = 0; i < points.length; i++) {
    const px = points[i].x * scaleX;
    const py = points[i].y * scaleY;
    ctx.beginPath();
    ctx.arc(px, py, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(251, 191, 36, 0.4)';
    ctx.fill();
  }
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
