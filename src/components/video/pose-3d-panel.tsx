'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { useAppContext } from '@/contexts/app-context';
import { X } from 'lucide-react';

// ─── Bone segments with color by body part ───────────────────────────────────
const SEGMENTS: Array<{ from: number; to: number; color: string }> = [
    // Face / head — red
    { from: 0, to: 1, color: '#ef4444' }, { from: 1, to: 2, color: '#ef4444' },
    { from: 2, to: 3, color: '#ef4444' }, { from: 3, to: 7, color: '#ef4444' },
    { from: 0, to: 4, color: '#ef4444' }, { from: 4, to: 5, color: '#ef4444' },
    { from: 5, to: 6, color: '#ef4444' }, { from: 6, to: 8, color: '#ef4444' },
    { from: 9, to: 10, color: '#ef4444' },
    // Torso — cyan
    { from: 11, to: 12, color: '#06b6d4' },
    { from: 11, to: 23, color: '#06b6d4' }, { from: 12, to: 24, color: '#06b6d4' },
    { from: 23, to: 24, color: '#06b6d4' },
    // Left arm — orange
    { from: 11, to: 13, color: '#f97316' }, { from: 13, to: 15, color: '#f97316' },
    { from: 15, to: 17, color: '#f97316' }, { from: 15, to: 19, color: '#f97316' },
    { from: 15, to: 21, color: '#f97316' }, { from: 17, to: 19, color: '#f97316' },
    // Right arm — magenta
    { from: 12, to: 14, color: '#e879f9' }, { from: 14, to: 16, color: '#e879f9' },
    { from: 16, to: 18, color: '#e879f9' }, { from: 16, to: 20, color: '#e879f9' },
    { from: 16, to: 22, color: '#e879f9' }, { from: 18, to: 20, color: '#e879f9' },
    // Left leg — orange
    { from: 23, to: 25, color: '#f97316' }, { from: 25, to: 27, color: '#f97316' },
    { from: 27, to: 29, color: '#f97316' }, { from: 29, to: 31, color: '#f97316' },
    { from: 27, to: 31, color: '#f97316' },
    // Right leg — magenta
    { from: 24, to: 26, color: '#e879f9' }, { from: 26, to: 28, color: '#e879f9' },
    { from: 28, to: 30, color: '#e879f9' }, { from: 30, to: 32, color: '#e879f9' },
    { from: 28, to: 32, color: '#e879f9' },
];

interface Pose3DPanelProps {
    worldLandmarksRef: React.MutableRefObject<NormalizedLandmark[] | null>;
}

// ─── Projection ───────────────────────────────────────────────────────────────
// MediaPipe world coords: X right, Y DOWN (head ≈ -0.5, feet ≈ +0.8), Z toward cam.
// To render right-side-up we negate Y so head goes up in screen space.
const project = (
    x: number, y: number, z: number,
    yaw: number, pitch: number,
    cx: number, cy: number,
    zoom: number,
): [number, number] => {
    // Negate Y so Y+ = up (MediaPipe Y+ = down)
    const yn = -y;

    // Rotate around Y axis (yaw — left/right spin)
    const cosYaw = Math.cos(yaw), sinYaw = Math.sin(yaw);
    const rx = x * cosYaw + z * sinYaw;
    const ry = yn;
    const rz = -x * sinYaw + z * cosYaw;

    // Rotate around X axis (pitch — tilt up/down)
    const cosPitch = Math.cos(pitch), sinPitch = Math.sin(pitch);
    const fx = rx;
    const fy = ry * cosPitch - rz * sinPitch;
    const fz = ry * sinPitch + rz * cosPitch;

    // Perspective divide
    const d = 3.0;
    const depth = Math.max(0.01, d + fz);
    const scale = zoom * d / depth;

    return [cx + fx * scale, cy - fy * scale];
};

export default function Pose3DPanel({ worldLandmarksRef }: Pose3DPanelProps) {
    const { toggle3DView } = useAppContext();
    const canvasRef = useRef<HTMLCanvasElement | null>(null);

    // Camera state stored in refs so the animation loop always has fresh values
    // without needing to restart when they change.
    const yawRef = useRef(-0.4);
    const pitchRef = useRef(0.25);
    const zoomRef = useRef(180);

    // Mirror into state only for the drag UI feedback (not for drawing)
    const [, forceUpdate] = useState(0);

    const isDraggingRef = useRef(false);
    const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
    const rafRef = useRef<number | null>(null);

    // ── Continuous animation loop ─────────────────────────────────────────────
    // Runs at display refresh rate, reads worldLandmarksRef directly.
    // No state updates → no React re-renders → no flicker.
    const loop = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) { rafRef.current = requestAnimationFrame(loop); return; }
        const ctx = canvas.getContext('2d');
        if (!ctx) { rafRef.current = requestAnimationFrame(loop); return; }

        const W = canvas.width;
        const H = canvas.height;
        const cx = W / 2;
        const cy = H / 2;
        const yaw = yawRef.current;
        const pitch = pitchRef.current;
        const zoom = zoomRef.current;
        const lms = worldLandmarksRef.current;

        ctx.clearRect(0, 0, W, H);

        // Background
        ctx.fillStyle = '#0a0f14';
        ctx.fillRect(0, 0, W, H);

        // ── Grid floor (world Y = +0.9, i.e. below feet after negation) ─────────
        const gridSize = 1.2;
        const steps = 8;
        ctx.strokeStyle = 'rgba(255,255,255,0.07)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= steps; i++) {
            const t = -gridSize + (2 * gridSize * i) / steps;
            const [ax, ay] = project(t, 0.9, -gridSize, yaw, pitch, cx, cy, zoom);
            const [bx, by] = project(t, 0.9, gridSize, yaw, pitch, cx, cy, zoom);
            const [gx, gy] = project(-gridSize, 0.9, t, yaw, pitch, cx, cy, zoom);
            const [dx, dy] = project(gridSize, 0.9, t, yaw, pitch, cx, cy, zoom);
            ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(dx, dy); ctx.stroke();
        }

        // ── Axis indicators ───────────────────────────────────────────────────────
        const al = 0.3;
        const [ox, oy] = project(0, 0, 0, yaw, pitch, cx, cy, zoom);
        for (const [ex, ey, ez, col] of [
            [al, 0, 0, '#ef4444'], [0, -al, 0, '#22c55e'], [0, 0, al, '#3b82f6'],
        ] as const) {
            const [tx, ty] = project(ex, ey, ez, yaw, pitch, cx, cy, zoom);
            ctx.strokeStyle = col; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(tx, ty); ctx.stroke();
        }

        if (!lms || lms.length < 25) {
            ctx.fillStyle = 'rgba(255,255,255,0.18)';
            ctx.font = '13px ui-monospace, monospace';
            ctx.textAlign = 'center';
            ctx.fillText('Waiting for pose data…', cx, cy + 4);
            ctx.textAlign = 'left';
            rafRef.current = requestAnimationFrame(loop);
            return;
        }

        // Project all landmarks
        const pts = lms.map((lm) =>
            project(lm.x, lm.y, lm.z ?? 0, yaw, pitch, cx, cy, zoom)
        );

        // ── Bones ─────────────────────────────────────────────────────────────────
        ctx.lineCap = 'round';
        for (const seg of SEGMENTS) {
            const a = pts[seg.from], b = pts[seg.to];
            if (!a || !b) continue;
            const vis = Math.min(lms[seg.from]?.visibility ?? 1, lms[seg.to]?.visibility ?? 1);
            ctx.globalAlpha = Math.max(0.15, vis);
            ctx.strokeStyle = seg.color;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.moveTo(a[0], a[1]);
            ctx.lineTo(b[0], b[1]);
            ctx.stroke();
        }

        // ── Joints ────────────────────────────────────────────────────────────────
        pts.forEach(([px, py], i) => {
            ctx.globalAlpha = Math.max(0.2, lms[i]?.visibility ?? 1);
            ctx.fillStyle = i <= 10 ? '#ef4444' : '#ffffff';
            ctx.beginPath();
            ctx.arc(px, py, i <= 10 ? 3 : 2.5, 0, Math.PI * 2);
            ctx.fill();
        });

        ctx.globalAlpha = 1;

        // ── Labels ────────────────────────────────────────────────────────────────
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.font = '11px ui-monospace, monospace';
        ctx.textAlign = 'left';
        ctx.fillText('3D · World Space', 10, 20);
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillText('drag to rotate · scroll to zoom', W - 10, H - 10);

        rafRef.current = requestAnimationFrame(loop);
    }, [worldLandmarksRef]);

    // Start / stop the loop on mount / unmount
    useEffect(() => {
        rafRef.current = requestAnimationFrame(loop);
        return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    }, [loop]);

    // ── Resize observer (re-sizes canvas to fill its container) ──────────────
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const parent = canvas.parentElement ?? canvas;
        const ro = new ResizeObserver(() => {
            canvas.width = parent.clientWidth;
            canvas.height = parent.clientHeight;
        });
        ro.observe(parent);
        // Set initial size
        canvas.width = parent.clientWidth;
        canvas.height = parent.clientHeight;
        return () => ro.disconnect();
    }, []);

    // ── Pointer orbit ─────────────────────────────────────────────────────────
    const onPointerDown = (e: React.PointerEvent) => {
        isDraggingRef.current = true;
        lastPointerRef.current = { x: e.clientX, y: e.clientY };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: React.PointerEvent) => {
        if (!isDraggingRef.current || !lastPointerRef.current) return;
        const dx = e.clientX - lastPointerRef.current.x;
        const dy = e.clientY - lastPointerRef.current.y;
        lastPointerRef.current = { x: e.clientX, y: e.clientY };
        yawRef.current += dx * 0.008;
        pitchRef.current = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitchRef.current + dy * 0.008));
        forceUpdate((n) => n + 1); // only to keep React happy — doesn't redraw
    };
    const onPointerUp = () => { isDraggingRef.current = false; };

    // ── Scroll zoom ───────────────────────────────────────────────────────────
    const onWheel = useCallback((e: WheelEvent) => {
        e.preventDefault();
        zoomRef.current = Math.max(60, Math.min(500, zoomRef.current - e.deltaY * 0.4));
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.addEventListener('wheel', onWheel, { passive: false });
        return () => canvas.removeEventListener('wheel', onWheel);
    }, [onWheel]);

    return (
        <div className="relative flex-shrink-0 w-[340px] xl:w-[400px] h-full rounded-xl overflow-hidden border border-white/10 bg-[#0a0f14] shadow-xl">
            <canvas
                ref={canvasRef}
                className="w-full h-full cursor-grab active:cursor-grabbing"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerLeave={onPointerUp}
            />
            <button
                type="button"
                onClick={toggle3DView}
                title="Close 3D viewer"
                className="absolute top-2 right-2 flex items-center justify-center h-7 w-7 rounded-full bg-white/10 hover:bg-white/25 text-white/70 hover:text-white transition-colors"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
