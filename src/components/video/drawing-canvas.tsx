'use client';

import React, { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import type { Drawing, DrawingType, Point } from '@/types';

interface DrawingCanvasProps {
  scale: number;
  position: { x: number; y: number };
  tool: DrawingType;
  color: string;
  isActive: boolean;
  drawings: Drawing[];
  onDrawingsChange: (drawings: Drawing[]) => void;
}

export default function DrawingCanvas({
  scale,
  position,
  tool,
  color,
  isActive,
  drawings,
  onDrawingsChange,
}: DrawingCanvasProps) {
  const [currentDrawing, setCurrentDrawing] = useState<Drawing | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const toLocal = (clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();

    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;

    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const x = (offsetX - cx - position.x) / scale + cx;
    const y = (offsetY - cy - position.y) / scale + cy;

    return { x, y };
  };

  const createDrawing = (type: DrawingType, point: Point): Drawing => ({
    id: crypto.randomUUID(),
    type,
    points: [point],
    start: point,
    end: point,
    color,
    strokeWidth: 3,
  });

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isActive) return;
    e.stopPropagation();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const point = toLocal(clientX, clientY);

    if (tool === 'text') {
      const label = window.prompt('Text label', 'Note');
      const text = label?.trim();
      if (!text) return;
      onDrawingsChange([
        ...drawings,
        {
          ...createDrawing('text', point),
          text,
          strokeWidth: 2,
        },
      ]);
      return;
    }

    if (tool === 'angle') {
      if (!currentDrawing || currentDrawing.type !== 'angle' || currentDrawing.points.length >= 3) {
        setCurrentDrawing(createDrawing('angle', point));
        return;
      }

      if (currentDrawing.points.length === 1) {
        setCurrentDrawing({
          ...currentDrawing,
          points: [currentDrawing.points[0], point],
          start: currentDrawing.points[0],
          end: point,
        });
        return;
      }

      const finalizedAngle: Drawing = {
        ...currentDrawing,
        points: [currentDrawing.points[0], currentDrawing.points[1], point],
        start: currentDrawing.points[0],
        end: point,
      };
      onDrawingsChange([...drawings, finalizedAngle]);
      setCurrentDrawing(null);
      return;
    }

    setCurrentDrawing(createDrawing(tool, point));
  };

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isActive || !currentDrawing) return;
    e.stopPropagation();

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const point = toLocal(clientX, clientY);

    if (currentDrawing.type === 'free') {
      setCurrentDrawing((prev) =>
        prev
          ? {
              ...prev,
              points: [...prev.points, point],
            }
          : null
      );
      return;
    }

    if (currentDrawing.type === 'angle') {
      setCurrentDrawing((prev) => {
        if (!prev) return null;
        if (prev.points.length === 1 || prev.points.length === 2) {
          return { ...prev, end: point };
        }
        return prev;
      });
      return;
    }

    setCurrentDrawing((prev) =>
      prev
        ? {
            ...prev,
            end: point,
          }
        : null
    );
  };

  const handleMouseUp = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isActive || !currentDrawing) return;
    e.stopPropagation();

    if (currentDrawing.type === 'angle' || currentDrawing.type === 'text') {
      return;
    }

    onDrawingsChange([...drawings, currentDrawing]);
    setCurrentDrawing(null);
  };

  const computeAngleDegrees = (a: Point, b: Point, c: Point) => {
    const ab = { x: a.x - b.x, y: a.y - b.y };
    const cb = { x: c.x - b.x, y: c.y - b.y };
    const dot = ab.x * cb.x + ab.y * cb.y;
    const magAB = Math.hypot(ab.x, ab.y);
    const magCB = Math.hypot(cb.x, cb.y);
    if (!magAB || !magCB) return null;
    const cosine = Math.max(-1, Math.min(1, dot / (magAB * magCB)));
    return Math.acos(cosine) * (180 / Math.PI);
  };

  const renderDrawing = (drawing: Drawing, isCurrent = false) => {
    const key = isCurrent ? 'current' : drawing.id;
    const style: React.CSSProperties = {
      stroke: drawing.color,
      strokeWidth: drawing.strokeWidth / scale,
      fill: 'none',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      vectorEffect: 'non-scaling-stroke',
    };

    if (drawing.type === 'free') {
      if (drawing.points.length === 1) {
        return <circle key={key} cx={drawing.points[0].x} cy={drawing.points[0].y} r={2.5 / scale} fill={drawing.color} />;
      }
      const pathData = `M ${drawing.points.map((p) => `${p.x},${p.y}`).join(' L ')}`;
      return <path key={key} d={pathData} style={style} />;
    }

    if (drawing.type === 'line') {
      return <line key={key} x1={drawing.start.x} y1={drawing.start.y} x2={drawing.end.x} y2={drawing.end.y} style={style} />;
    }

    if (drawing.type === 'arrow') {
      const dx = drawing.end.x - drawing.start.x;
      const dy = drawing.end.y - drawing.start.y;
      const angle = Math.atan2(dy, dx);
      const headLength = 10 / scale;

      const arrowX1 = drawing.end.x - headLength * Math.cos(angle - Math.PI / 6);
      const arrowY1 = drawing.end.y - headLength * Math.sin(angle - Math.PI / 6);
      const arrowX2 = drawing.end.x - headLength * Math.cos(angle + Math.PI / 6);
      const arrowY2 = drawing.end.y - headLength * Math.sin(angle + Math.PI / 6);

      return (
        <g key={key}>
          <line x1={drawing.start.x} y1={drawing.start.y} x2={drawing.end.x} y2={drawing.end.y} style={style} />
          <path
            d={`M ${drawing.end.x} ${drawing.end.y} L ${arrowX1} ${arrowY1} L ${arrowX2} ${arrowY2} Z`}
            style={{ ...style, stroke: 'none', fill: drawing.color }}
          />
        </g>
      );
    }

    if (drawing.type === 'rectangle') {
      const x = Math.min(drawing.start.x, drawing.end.x);
      const y = Math.min(drawing.start.y, drawing.end.y);
      const widthValue = Math.abs(drawing.end.x - drawing.start.x);
      const heightValue = Math.abs(drawing.end.y - drawing.start.y);
      return <rect key={key} x={x} y={y} width={widthValue} height={heightValue} style={style} />;
    }

    if (drawing.type === 'circle') {
      const radius = Math.hypot(drawing.end.x - drawing.start.x, drawing.end.y - drawing.start.y);
      return <circle key={key} cx={drawing.start.x} cy={drawing.start.y} r={radius} style={style} />;
    }

    if (drawing.type === 'angle') {
      const [point1, point2] = drawing.points;
      if (!point1) return null;
      if (!point2) {
        return <circle key={key} cx={point1.x} cy={point1.y} r={2.5 / scale} fill={drawing.color} />;
      }

      const point3 = drawing.points[2] || drawing.end;
      const angleDegrees = computeAngleDegrees(point1, point2, point3);
      const angleLabel = angleDegrees !== null ? `${angleDegrees.toFixed(1)}°` : null;

      return (
        <g key={key}>
          <line x1={point2.x} y1={point2.y} x2={point1.x} y2={point1.y} style={style} />
          <line x1={point2.x} y1={point2.y} x2={point3.x} y2={point3.y} style={style} />
          <circle cx={point2.x} cy={point2.y} r={3 / scale} fill={drawing.color} />
          {angleLabel && (
            <text
              x={point2.x + 8 / scale}
              y={point2.y - 8 / scale}
              fill={drawing.color}
              fontSize={12 / scale}
              fontWeight={700}
              style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.45)', strokeWidth: 2 / scale }}
            >
              {angleLabel}
            </text>
          )}
        </g>
      );
    }

    if (drawing.type === 'text') {
      return (
        <text
          key={key}
          x={drawing.start.x}
          y={drawing.start.y}
          fill={drawing.color}
          fontSize={16 / scale}
          fontWeight={700}
          style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.45)', strokeWidth: 3 / scale }}
        >
          {drawing.text ?? 'Note'}
        </text>
      );
    }

    return null;
  };

  return (
    <div
      ref={containerRef}
      className={cn('absolute inset-0 z-10 h-full w-full touch-none', isActive ? 'cursor-crosshair pointer-events-auto' : 'pointer-events-none')}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleMouseDown}
      onTouchMove={handleMouseMove}
      onTouchEnd={handleMouseUp}
      onTouchCancel={handleMouseUp}
    >
      <svg
        className="h-full w-full overflow-visible"
        style={{
          transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
          transformOrigin: '50% 50%',
        }}
      >
        {drawings.map((drawing) => renderDrawing(drawing))}
        {currentDrawing && renderDrawing(currentDrawing, true)}
      </svg>
    </div>
  );
}
