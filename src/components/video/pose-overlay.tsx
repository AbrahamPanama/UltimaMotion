'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { PoseModelVariant } from '@/types';
import { cn } from '@/lib/utils';
import { usePoseLandmarks } from '@/hooks/use-pose-landmarks';

const POSE_CONNECTIONS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 7],
  [0, 4], [4, 5], [5, 6], [6, 8],
  [9, 10],
  [11, 12],
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [24, 26], [25, 27], [26, 28],
  [27, 29], [28, 30], [29, 31], [30, 32],
  [27, 31], [28, 32],
];

interface PoseOverlayProps {
  enabled: boolean;
  videoElement: HTMLVideoElement | null;
  scale: number;
  position: { x: number; y: number };
  objectFit: 'contain' | 'cover';
  modelVariant: PoseModelVariant;
  targetFps: number;
  minVisibility: number;
  minPoseDetectionConfidence: number;
  minPosePresenceConfidence: number;
  minTrackingConfidence: number;
}

interface ProjectedPoint {
  x: number;
  y: number;
  visibility: number;
}

interface PoseBox {
  x: number;
  y: number;
  width: number;
  height: number;
  area: number;
  center: { x: number; y: number };
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const normalizeLandmarks = (
  landmarks: NormalizedLandmark[],
  sourceWidth: number,
  sourceHeight: number
): ProjectedPoint[] =>
  landmarks.map((landmark) => ({
    x: clamp01(Number.isFinite(landmark.x) ? landmark.x : 0.5) * sourceWidth,
    y: clamp01(Number.isFinite(landmark.y) ? landmark.y : 0.5) * sourceHeight,
    visibility: clamp01(Number.isFinite(landmark.visibility) ? landmark.visibility : 1),
  }));

const getPoseCenter = (pose: ProjectedPoint[]) => {
  const candidates = pose.filter((point) => point.visibility >= 0.1);
  const points = candidates.length > 0 ? candidates : pose;
  if (points.length === 0) return null;

  const sum = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 }
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
};

const getPoseBoundingArea = (pose: ProjectedPoint[]) => {
  const points = pose.filter((point) => point.visibility >= 0.1);
  if (points.length === 0) return 0;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  return Math.max(0, width * height);
};

const getPoseBox = (pose: ProjectedPoint[], sourceWidth: number, sourceHeight: number): PoseBox | null => {
  const points = pose.filter((point) => point.visibility >= 0.1);
  const selected = points.length > 0 ? points : pose;
  if (selected.length === 0) return null;

  const xs = selected.map((point) => point.x);
  const ys = selected.map((point) => point.y);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const paddingX = Math.max(8, (maxX - minX) * 0.08);
  const paddingY = Math.max(8, (maxY - minY) * 0.1);

  const x = Math.max(0, minX - paddingX);
  const y = Math.max(0, minY - paddingY);
  const right = Math.min(sourceWidth, maxX + paddingX);
  const bottom = Math.min(sourceHeight, maxY + paddingY);
  const width = Math.max(1, right - x);
  const height = Math.max(1, bottom - y);

  return {
    x,
    y,
    width,
    height,
    area: width * height,
    center: { x: x + width / 2, y: y + height / 2 },
  };
};

const getDistanceSq = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};

const getNearestPoseIndex = (poses: ProjectedPoint[][], target: { x: number; y: number }) => {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;

  poses.forEach((pose, index) => {
    const center = getPoseCenter(pose);
    if (!center) return;
    const distance = getDistanceSq(center, target);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });

  return bestIndex;
};

const isPointInBox = (point: { x: number; y: number }, box: PoseBox) =>
  point.x >= box.x &&
  point.x <= box.x + box.width &&
  point.y >= box.y &&
  point.y <= box.y + box.height;

const getAutoPoseIndex = (poses: ProjectedPoint[][]) => {
  if (poses.length === 0) return -1;

  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;

  poses.forEach((pose, index) => {
    const visibleCount = pose.filter((point) => point.visibility >= 0.1).length;
    const area = getPoseBoundingArea(pose);
    const score = visibleCount * 1000 + area;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestIndex;
};

export default function PoseOverlay({
  enabled,
  videoElement,
  scale,
  position,
  objectFit,
  modelVariant,
  targetFps,
  minVisibility,
  minPoseDetectionConfidence,
  minPosePresenceConfidence,
  minTrackingConfidence,
}: PoseOverlayProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const lockAnchorRef = useRef<{ x: number; y: number } | null>(null);
  const lockedPoseIndexHintRef = useRef<number | null>(null);
  const previousMediaTimeRef = useRef<number | null>(null);
  const didLoopRecentlyRef = useRef(false);

  const [isSelectingTarget, setIsSelectingTarget] = useState(false);
  const [isLocked, setIsLocked] = useState(false);

  const { status, poses, error, inferenceFps, poseCount, mediaTimeMs, delegate, activeModel } = usePoseLandmarks({
    enabled,
    videoElement,
    modelVariant,
    targetFps,
    minPoseDetectionConfidence,
    minPosePresenceConfidence,
    minTrackingConfidence,
  });

  const projectedPoses = useMemo<ProjectedPoint[][]>(() => {
    if (!poses || poses.length === 0) return [];
    const sourceWidth = videoElement?.videoWidth || 1;
    const sourceHeight = videoElement?.videoHeight || 1;
    return poses.map((pose) => normalizeLandmarks(pose, sourceWidth, sourceHeight));
  }, [poses, videoElement]);

  useEffect(() => {
    if (projectedPoses.length === 0) {
      setIsSelectingTarget(false);
    }
  }, [projectedPoses.length]);

  useEffect(() => {
    const previous = previousMediaTimeRef.current;
    if (previous !== null && mediaTimeMs + 150 < previous) {
      didLoopRecentlyRef.current = true;
    }
    previousMediaTimeRef.current = mediaTimeMs;
  }, [mediaTimeMs]);

  if (!enabled) return null;

  const sourceWidth = videoElement?.videoWidth || 1;
  const sourceHeight = videoElement?.videoHeight || 1;
  const projectedBoxes = useMemo<Array<PoseBox | null>>(
    () => projectedPoses.map((pose) => getPoseBox(pose, sourceWidth, sourceHeight)),
    [projectedPoses, sourceWidth, sourceHeight]
  );

  const selectedPoseIndex = (() => {
    if (projectedPoses.length === 0) return -1;

    if (!isLocked) {
      return getAutoPoseIndex(projectedPoses);
    }

    if (didLoopRecentlyRef.current && lockedPoseIndexHintRef.current !== null) {
      const loopIndex = lockedPoseIndexHintRef.current;
      if (loopIndex >= 0 && loopIndex < projectedPoses.length) {
        const center = projectedBoxes[loopIndex]?.center ?? getPoseCenter(projectedPoses[loopIndex]);
        if (center) {
          lockAnchorRef.current = center;
        }
        didLoopRecentlyRef.current = false;
        return loopIndex;
      }
    }

    if (!lockAnchorRef.current) {
      const hintIndex = lockedPoseIndexHintRef.current;
      if (hintIndex !== null && hintIndex >= 0 && hintIndex < projectedPoses.length) {
        const center = projectedBoxes[hintIndex]?.center ?? getPoseCenter(projectedPoses[hintIndex]);
        if (center) {
          lockAnchorRef.current = center;
        }
        return hintIndex;
      }

      const autoIndex = getAutoPoseIndex(projectedPoses);
      const center = autoIndex >= 0
        ? projectedBoxes[autoIndex]?.center ?? getPoseCenter(projectedPoses[autoIndex])
        : null;
      if (center) {
        lockAnchorRef.current = center;
      }
      return autoIndex;
    }

    const nearestIndex = getNearestPoseIndex(projectedPoses, lockAnchorRef.current);
    const center = projectedBoxes[nearestIndex]?.center ?? getPoseCenter(projectedPoses[nearestIndex]);
    if (center) {
      lockAnchorRef.current = center;
    }
    return nearestIndex;
  })();

  if (selectedPoseIndex >= 0) {
    lockedPoseIndexHintRef.current = selectedPoseIndex;
  }

  const selectedPose = selectedPoseIndex >= 0 ? projectedPoses[selectedPoseIndex] : null;
  const selectedBox = selectedPoseIndex >= 0 ? projectedBoxes[selectedPoseIndex] : null;
  const drawPose = selectedPose && selectedPose.length > 0;
  const visibleLandmarkCount = selectedPose
    ? selectedPose.filter((point) => point.visibility >= minVisibility).length
    : 0;
  const relaxedVisibilityGate = visibleLandmarkCount === 0;
  const landmarkCount = selectedPose?.length ?? 0;
  const preserveAspectRatio = objectFit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';

  const handleTapToLock = (event: React.MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!isSelectingTarget || projectedPoses.length === 0) return;

    const svg = svgRef.current;
    if (!svg) return;

    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const svgPoint = point.matrixTransform(ctm.inverse());

    const nextTarget = { x: svgPoint.x, y: svgPoint.y };

    const hitCandidates = projectedBoxes
      .map((box, index) => ({ box, index }))
      .filter((entry): entry is { box: PoseBox; index: number } => Boolean(entry.box))
      .filter((entry) => isPointInBox(nextTarget, entry.box))
      .sort((a, b) => a.box.area - b.box.area);

    const targetIndex = hitCandidates.length > 0
      ? hitCandidates[0].index
      : getNearestPoseIndex(projectedPoses, nextTarget);

    const center = projectedBoxes[targetIndex]?.center
      ?? getPoseCenter(projectedPoses[targetIndex])
      ?? nextTarget;

    lockAnchorRef.current = center;
    lockedPoseIndexHintRef.current = targetIndex;
    setIsLocked(true);
    setIsSelectingTarget(false);
  };

  const handleUnlock = () => {
    lockAnchorRef.current = null;
    lockedPoseIndexHintRef.current = null;
    setIsLocked(false);
    setIsSelectingTarget(false);
  };

  return (
    <div className="absolute inset-0 z-[9] h-full w-full pointer-events-none">
      {isSelectingTarget && (
        <div
          className="absolute inset-0 z-10 cursor-crosshair pointer-events-auto"
          onClick={handleTapToLock}
          title="Tap a person to lock pose tracking"
        />
      )}

      <svg
        ref={svgRef}
        className="h-full w-full overflow-visible"
        viewBox={`0 0 ${sourceWidth} ${sourceHeight}`}
        preserveAspectRatio={preserveAspectRatio}
        style={{
          transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
          transformOrigin: '50% 50%',
        }}
      >
        {isSelectingTarget && projectedBoxes.map((box, index) => {
          if (!box) return null;
          const isSelected = index === selectedPoseIndex;
          return (
            <g key={`pose-box-${index}`}>
              <rect
                x={box.x}
                y={box.y}
                width={box.width}
                height={box.height}
                fill={isSelected ? 'rgba(16,185,129,0.12)' : 'rgba(14,165,233,0.08)'}
                stroke={isSelected ? '#10b981' : '#38bdf8'}
                strokeWidth={2 / scale}
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={box.x + 6 / scale}
                y={box.y + 14 / scale}
                fill={isSelected ? '#d1fae5' : '#e0f2fe'}
                fontSize={11 / scale}
                fontWeight={700}
                style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.45)', strokeWidth: 2 / scale }}
              >
                Tap to lock
              </text>
            </g>
          );
        })}

        {selectedBox && (
          <rect
            x={selectedBox.x}
            y={selectedBox.y}
            width={selectedBox.width}
            height={selectedBox.height}
            fill="none"
            stroke={isLocked ? '#facc15' : '#38bdf8'}
            strokeDasharray={isLocked ? `${6 / scale} ${3 / scale}` : undefined}
            strokeWidth={2.2 / scale}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {drawPose && POSE_CONNECTIONS.map(([fromIndex, toIndex]) => {
          if (!selectedPose) return null;
          const from = selectedPose[fromIndex];
          const to = selectedPose[toIndex];
          if (!from || !to) return null;
          const lineGate = Math.min(minVisibility, 0.05);
          if (!relaxedVisibilityGate && (from.visibility < lineGate || to.visibility < lineGate)) return null;
          const lineOpacity = relaxedVisibilityGate
            ? 0.55
            : Math.max(0.35, Math.min(1, Math.min(from.visibility, to.visibility)));
          return (
            <line
              key={`${fromIndex}-${toIndex}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#14b8a6"
              strokeOpacity={lineOpacity}
              strokeWidth={2 / scale}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}

        {drawPose && selectedPose?.map((point, index) => {
          if (!relaxedVisibilityGate && point.visibility < minVisibility) return null;
          const opacity = relaxedVisibilityGate
            ? Math.max(0.35, point.visibility || 0)
            : 1;
          return (
            <circle
              key={`pose-point-${index}`}
              cx={point.x}
              cy={point.y}
              r={2.8 / scale}
              fill="#f8fafc"
              stroke="#0f766e"
              fillOpacity={opacity}
              strokeOpacity={opacity}
              strokeWidth={1 / scale}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
      </svg>

      <div
        className={cn(
          'absolute left-2 top-2 rounded-md px-2 py-1 text-[10px] font-semibold text-white/90 backdrop-blur-sm pointer-events-auto',
          status === 'error' ? 'bg-red-950/70' : 'bg-black/45'
        )}
      >
        {status === 'error' ? (
          `Pose error: ${error ?? 'unknown'}`
        ) : (
          <div className="flex items-center gap-2">
            <span>
              {`Pose ${status === 'loading' ? 'loading' : 'live'} · ${(activeModel ?? modelVariant).toUpperCase()} · ${delegate ?? '...'} · ${inferenceFps.toFixed(1)} fps · poses:${poseCount} · lm:${landmarkCount} vis:${visibleLandmarkCount} · ${isLocked ? 'locked' : 'auto'}`}
            </span>
            {projectedPoses.length > 1 && !isLocked && (
              <button
                type="button"
                className="rounded border border-white/30 px-1.5 py-0.5 text-[10px] hover:bg-white/15"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsSelectingTarget((prev) => !prev);
                }}
              >
                {isSelectingTarget ? 'Cancel' : 'Tap target'}
              </button>
            )}
            {isLocked && (
              <button
                type="button"
                className="rounded border border-white/30 px-1.5 py-0.5 text-[10px] hover:bg-white/15"
                onClick={(event) => {
                  event.stopPropagation();
                  handleUnlock();
                }}
              >
                Unlock
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
