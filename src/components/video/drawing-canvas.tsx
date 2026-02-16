'use client';
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { cn } from '@/lib/utils';

export type DrawingType = 'free' | 'arrow' | 'circle';

export interface Point {
    x: number;
    y: number;
}

export interface Drawing {
    id: string;
    type: DrawingType;
    points: Point[];      // For freehand
    start: Point;         // For arrow/circle
    end: Point;           // For arrow/circle
    color: string;
    strokeWidth: number;
}

interface DrawingCanvasProps {
    width: number;
    height: number;
    scale: number;
    position: { x: number, y: number };
    tool: DrawingType;
    color: string;
    isActive: boolean;
    drawings: Drawing[];
    onDrawingsChange: (drawings: Drawing[]) => void;
}

export default function DrawingCanvas({
    width,
    height,
    scale,
    position,
    tool,
    color,
    isActive,
    drawings,
    onDrawingsChange
}: DrawingCanvasProps) {
    const [currentDrawing, setCurrentDrawing] = useState<Drawing | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Transform screen coordinate (relative to container) to local video coordinate
    const toLocal = (clientX: number, clientY: number) => {
        if (!containerRef.current) return { x: 0, y: 0 };
        const rect = containerRef.current.getBoundingClientRect();
        
        // Mouse relative to container top-left
        const offsetX = clientX - rect.left;
        const offsetY = clientY - rect.top;

        // Container Center
        const cx = rect.width / 2;
        const cy = rect.height / 2;

        // Inverse Transform:
        // ScreenX = CenterX + (LocalX - CenterX) * scale + position.x
        // LocalX = (ScreenX - CenterX - position.x) / scale + CenterX

        const x = (offsetX - cx - position.x) / scale + cx;
        const y = (offsetY - cy - position.y) / scale + cy;

        return { x, y };
    };

    const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isActive) return;
        // e.preventDefault(); // Prevent scrolling on touch?
        e.stopPropagation(); // Prevent panning

        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;
        
        const point = toLocal(clientX, clientY);
        
        const newDrawing: Drawing = {
            id: crypto.randomUUID(),
            type: tool,
            points: [point],
            start: point,
            end: point,
            color,
            strokeWidth: 3, // Could be configurable
        };
        
        setCurrentDrawing(newDrawing);
    };

    const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isActive || !currentDrawing) return;
        e.stopPropagation();

        const clientX = 'touches' in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : (e as React.MouseEvent).clientY;

        const point = toLocal(clientX, clientY);

        if (tool === 'free') {
            setCurrentDrawing(prev => prev ? ({
                ...prev,
                points: [...prev.points, point]
            }) : null);
        } else {
            // Arrow and Circle just update the 'end' point
            setCurrentDrawing(prev => prev ? ({
                ...prev,
                end: point
            }) : null);
        }
    };

    const handleMouseUp = (e: React.MouseEvent | React.TouchEvent) => {
        if (!isActive || !currentDrawing) return;
        e.stopPropagation();
        
        // Finalize
        onDrawingsChange([...drawings, currentDrawing]);
        setCurrentDrawing(null);
    };

    // Render helpers
    const renderDrawing = (d: Drawing, isCurrent = false) => {
        const key = isCurrent ? 'current' : d.id;
        const style = {
            stroke: d.color,
            strokeWidth: d.strokeWidth / scale, // Scale stroke width so it stays constant relative to screen? Or constant relative to video? 
            // If we want constant screen thickness, divide by scale. If constant video thickness, leave as is.
            // Usually graphical analysis implies constant screen thickness is better for visibility, 
            // OR constant video thickness if it's "part of the video".
            // Let's try constant VIDEO thickness for now (so it zooms with video), but prevent it getting too huge?
            // Actually standard SVG behavior (zoomable map) is stroke-width scales.
            // If I want constant screen width, I use `vector-effect="non-scaling-stroke"`.
            fill: 'none',
            strokeLinecap: 'round' as const,
            strokeLinejoin: 'round' as const,
            vectorEffect: 'non-scaling-stroke' // This keeps line width constant regardless of zoom!
        };

        if (d.type === 'free') {
            const pathData = `M ${d.points.map(p => `${p.x},${p.y}`).join(' L ')}`;
            return <path key={key} d={pathData} style={style} />;
        } else if (d.type === 'arrow') {
            // Draw line
            // We need a marker. We can define marker in defs.
            // But color changes...
            // Easier to draw arrowhead manually as a polygon or path.
            
            const dx = d.end.x - d.start.x;
            const dy = d.end.y - d.start.y;
            const angle = Math.atan2(dy, dx);
            const headLen = 15 / scale; // Scale head so it doesn't get huge? Or non-scaling?
            // non-scaling-stroke doesn't apply to geometry.
            // We probably want the arrow head to stay reasonable size on screen.
            
            // Actually, if we use non-scaling-stroke for the line, the line stays thin. 
            // The arrowhead geometry will scale with zoom.
            // Let's divide by scale for head size to keep it somewhat constant on screen.
            const hLen = 10 / scale;

            const arrowX1 = d.end.x - hLen * Math.cos(angle - Math.PI / 6);
            const arrowY1 = d.end.y - hLen * Math.sin(angle - Math.PI / 6);
            const arrowX2 = d.end.x - hLen * Math.cos(angle + Math.PI / 6);
            const arrowY2 = d.end.y - hLen * Math.sin(angle + Math.PI / 6);

            return (
                <g key={key}>
                    <line x1={d.start.x} y1={d.start.y} x2={d.end.x} y2={d.end.y} style={style} />
                    <path d={`M ${d.end.x} ${d.end.y} L ${arrowX1} ${arrowY1} L ${arrowX2} ${arrowY2} Z`} fill={d.color} style={{...style, stroke: 'none', fill: d.color}} />
                </g>
            );
        } else if (d.type === 'circle') {
            const r = Math.sqrt(Math.pow(d.end.x - d.start.x, 2) + Math.pow(d.end.y - d.start.y, 2));
            return <circle key={key} cx={d.start.x} cy={d.start.y} r={r} style={style} />;
        }
        return null;
    };

    return (
        <div 
            ref={containerRef}
            className={cn(
                "absolute inset-0 w-full h-full z-10 touch-none",
                isActive ? "cursor-crosshair pointer-events-auto" : "pointer-events-none"
            )}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleMouseDown}
            onTouchMove={handleMouseMove}
            onTouchEnd={handleMouseUp}
        >
            <svg 
                className="w-full h-full overflow-visible"
                style={{
                    transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
                    transformOrigin: '50% 50%'
                }}
            >
                {drawings.map(d => renderDrawing(d))}
                {currentDrawing && renderDrawing(currentDrawing, true)}
            </svg>
        </div>
    );
}
