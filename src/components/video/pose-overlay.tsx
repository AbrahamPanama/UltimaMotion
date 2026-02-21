'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { PoseModelVariant } from '@/types';
import { cn } from '@/lib/utils';
import { usePoseLandmarks } from '@/hooks/use-pose-landmarks';
import {
  computeCoG,
  computeJointAngles,
  computeBodyLean,
  updateJumpHeight,
  createJumpHeightState,
  type JointAngle,
  type JumpHeightState,
} from '@/lib/pose/biomechanics';

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
  useExactFrameSync: boolean;
  minVisibility: number;
  showCoG: boolean;
  showJointAngles: boolean;
  showBodyLean: boolean;
  showJumpHeight: boolean;
  minPoseDetectionConfidence: number;
  minPosePresenceConfidence: number;
  minTrackingConfidence: number;
  onWorldLandmarks?: (landmarks: NormalizedLandmark[] | null) => void;
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

// ── SVG Arc helper for joint angles ──

const describeArc = (
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  sweepAngle: number
): string => {
  const startX = cx + radius * Math.cos(startAngle);
  const startY = cy + radius * Math.sin(startAngle);
  const endAngle = startAngle + sweepAngle;
  const endX = cx + radius * Math.cos(endAngle);
  const endY = cy + radius * Math.sin(endAngle);
  const largeArc = Math.abs(sweepAngle) > Math.PI ? 1 : 0;
  const sweepFlag = sweepAngle > 0 ? 1 : 0;
  return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} ${sweepFlag} ${endX} ${endY}`;
};

// ── Angle label position ──

const getAngleLabelPosition = (angle: JointAngle, radius: number) => {
  const midAngle = angle.startAngle + angle.sweepAngle / 2;
  return {
    x: angle.vertex.x + (radius + 8) * Math.cos(midAngle),
    y: angle.vertex.y + (radius + 8) * Math.sin(midAngle),
  };
};

export default function PoseOverlay({
  enabled,
  videoElement,
  scale,
  position,
  objectFit,
  modelVariant,
  targetFps,
  useExactFrameSync,
  minVisibility,
  showCoG,
  showJointAngles,
  showBodyLean,
  showJumpHeight,
  minPoseDetectionConfidence,
  minPosePresenceConfidence,
  minTrackingConfidence,
  onWorldLandmarks,
}: PoseOverlayProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const jumpHeightStateRef = useRef<JumpHeightState>(createJumpHeightState());

  const { status, poses, worldPoses, error, inferenceFps, poseCount, mediaTimeMs, delegate, activeModel } = usePoseLandmarks({
    enabled,
    videoElement,
    modelVariant,
    targetFps,
    useExactFrameSync,
    minPoseDetectionConfidence,
    minPosePresenceConfidence,
    minTrackingConfidence,
  });

  // Fire onWorldLandmarks whenever the selected person's world landmarks change
  useEffect(() => {
    if (!onWorldLandmarks) return;
    if (!enabled || !worldPoses || worldPoses.length === 0) {
      onWorldLandmarks(null);
      return;
    }
    onWorldLandmarks(worldPoses[0] ?? null);
  }, [enabled, worldPoses, onWorldLandmarks]);

  // Reset jump height state when jump height is toggled off or pose disabled
  useEffect(() => {
    if (!enabled || !showJumpHeight) {
      jumpHeightStateRef.current = createJumpHeightState();
    }
  }, [enabled, showJumpHeight]);

  const sourceWidth = videoElement?.videoWidth || 1;
  const sourceHeight = videoElement?.videoHeight || 1;

  // Project normalized [0,1] landmarks to pixel space for rendering
  const projectedPoses = useMemo<ProjectedPoint[][]>(() => {
    if (!poses || poses.length === 0) return [];
    return poses.map((pose) => normalizeLandmarks(pose, sourceWidth, sourceHeight));
  }, [poses, sourceWidth, sourceHeight]);

  if (!enabled) return null;

  // Always auto-select the most prominent pose
  const selectedPoseIndex = getAutoPoseIndex(projectedPoses);
  const selectedPose = selectedPoseIndex >= 0 ? projectedPoses[selectedPoseIndex] : null;
  const selectedBox = selectedPose
    ? getPoseBox(selectedPose, sourceWidth, sourceHeight)
    : null;
  const drawPose = selectedPose && selectedPose.length > 0;
  const visibleLandmarkCount = selectedPose
    ? selectedPose.filter((point) => point.visibility >= minVisibility).length
    : 0;
  const relaxedVisibilityGate = visibleLandmarkCount === 0;
  const landmarkCount = selectedPose?.length ?? 0;
  const preserveAspectRatio = objectFit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';

  // ── Biomechanics computations (only when individually enabled) ──
  const cog = (showCoG || showJumpHeight) && selectedPose ? computeCoG(selectedPose) : null;
  const jointAngles = showJointAngles && selectedPose ? computeJointAngles(selectedPose) : [];
  const bodyLean = showBodyLean && selectedPose ? computeBodyLean(selectedPose) : null;
  const jumpHeight = showJumpHeight && cog
    ? updateJumpHeight(jumpHeightStateRef.current, cog, sourceHeight, mediaTimeMs)
    : null;

  const arcRadius = Math.max(16, sourceWidth * 0.025);
  const fontSize = Math.max(10, sourceWidth * 0.012);

  return (
    <div className="absolute inset-0 z-[9] h-full w-full pointer-events-none">
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
        {selectedBox && (
          <rect
            x={selectedBox.x}
            y={selectedBox.y}
            width={selectedBox.width}
            height={selectedBox.height}
            fill="none"
            stroke="#38bdf8"
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

        {/* ── Center of Gravity ── */}
        {showCoG && cog && (
          <g>
            {/* Pulsing ring */}
            <circle
              cx={cog.x}
              cy={cog.y}
              r={8 / scale}
              fill="none"
              stroke="#facc15"
              strokeWidth={1.5 / scale}
              strokeOpacity={0.6}
              vectorEffect="non-scaling-stroke"
            >
              <animate attributeName="r" values={`${8 / scale};${12 / scale};${8 / scale}`} dur="2s" repeatCount="indefinite" />
              <animate attributeName="stroke-opacity" values="0.6;0.2;0.6" dur="2s" repeatCount="indefinite" />
            </circle>
            {/* Crosshair */}
            <line x1={cog.x - 6 / scale} y1={cog.y} x2={cog.x + 6 / scale} y2={cog.y}
              stroke="#facc15" strokeWidth={2 / scale} vectorEffect="non-scaling-stroke" />
            <line x1={cog.x} y1={cog.y - 6 / scale} x2={cog.x} y2={cog.y + 6 / scale}
              stroke="#facc15" strokeWidth={2 / scale} vectorEffect="non-scaling-stroke" />
            {/* Dot */}
            <circle cx={cog.x} cy={cog.y} r={2.5 / scale} fill="#facc15" />
            {/* Label */}
            <text
              x={cog.x + 12 / scale}
              y={cog.y - 4 / scale}
              fill="#fde68a"
              fontSize={fontSize / scale}
              fontWeight={700}
              style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.6)', strokeWidth: 2.5 / scale }}
            >
              CoG
            </text>
          </g>
        )}

        {/* ── Joint Angles ── */}
        {jointAngles.map((angle) => {
          const labelPos = getAngleLabelPosition(angle, arcRadius / scale);
          return (
            <g key={angle.label}>
              {/* Arc */}
              <path
                d={describeArc(angle.vertex.x, angle.vertex.y, arcRadius / scale, angle.startAngle, angle.sweepAngle)}
                fill="none"
                stroke="rgba(255,255,255,0.75)"
                strokeWidth={1.5 / scale}
                vectorEffect="non-scaling-stroke"
              />
              {/* Degree label */}
              <text
                x={labelPos.x}
                y={labelPos.y}
                fill="#ffffff"
                fontSize={fontSize * 0.85 / scale}
                fontWeight={600}
                textAnchor="middle"
                dominantBaseline="central"
                style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.55)', strokeWidth: 2 / scale }}
              >
                {`${Math.round(angle.degrees)}°`}
              </text>
            </g>
          );
        })}

        {/* ── Body Lean ── */}
        {bodyLean && (
          <g>
            {/* Vertical reference line from hip midpoint */}
            <line
              x1={bodyLean.hipMid.x}
              y1={bodyLean.hipMid.y}
              x2={bodyLean.hipMid.x}
              y2={bodyLean.shoulderMid.y}
              stroke="rgba(34,211,238,0.35)"
              strokeWidth={1.5 / scale}
              strokeDasharray={`${4 / scale} ${3 / scale}`}
              vectorEffect="non-scaling-stroke"
            />
            {/* Actual torso line (already drawn by skeleton, but we highlight) */}
            <line
              x1={bodyLean.hipMid.x}
              y1={bodyLean.hipMid.y}
              x2={bodyLean.shoulderMid.x}
              y2={bodyLean.shoulderMid.y}
              stroke="#22d3ee"
              strokeWidth={2 / scale}
              strokeOpacity={0.7}
              vectorEffect="non-scaling-stroke"
            />
            {/* Lean label */}
            <text
              x={bodyLean.hipMid.x + 14 / scale}
              y={(bodyLean.hipMid.y + bodyLean.shoulderMid.y) / 2}
              fill="#22d3ee"
              fontSize={fontSize / scale}
              fontWeight={700}
              style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.55)', strokeWidth: 2 / scale }}
            >
              {`${Math.abs(bodyLean.angleDeg).toFixed(1)}° ${bodyLean.angleDeg > 0.5 ? 'R' : bodyLean.angleDeg < -0.5 ? 'L' : ''}`}
            </text>
          </g>
        )}

        {/* ── Jump Height ── */}
        {jumpHeight && (
          <g>
            {/* Baseline horizontal line */}
            <line
              x1={jumpHeight.cogPosition.x - 30 / scale}
              y1={jumpHeight.baselineY}
              x2={jumpHeight.cogPosition.x + 30 / scale}
              y2={jumpHeight.baselineY}
              stroke="#22c55e"
              strokeWidth={1.5 / scale}
              strokeDasharray={`${4 / scale} ${2 / scale}`}
              strokeOpacity={0.7}
              vectorEffect="non-scaling-stroke"
            />
            {/* Vertical arrow from baseline to CoG */}
            <line
              x1={jumpHeight.cogPosition.x}
              y1={jumpHeight.baselineY}
              x2={jumpHeight.cogPosition.x}
              y2={jumpHeight.cogPosition.y}
              stroke="#22c55e"
              strokeWidth={2 / scale}
              strokeOpacity={0.8}
              vectorEffect="non-scaling-stroke"
            />
            {/* Triangle arrowhead at top */}
            <polygon
              points={`${jumpHeight.cogPosition.x},${jumpHeight.cogPosition.y} ${jumpHeight.cogPosition.x - 4 / scale},${jumpHeight.cogPosition.y + 8 / scale} ${jumpHeight.cogPosition.x + 4 / scale},${jumpHeight.cogPosition.y + 8 / scale}`}
              fill="#22c55e"
              fillOpacity={0.8}
            />
            {/* Height label */}
            <text
              x={jumpHeight.cogPosition.x + 10 / scale}
              y={(jumpHeight.baselineY + jumpHeight.cogPosition.y) / 2}
              fill="#86efac"
              fontSize={fontSize * 1.1 / scale}
              fontWeight={700}
              style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.6)', strokeWidth: 2.5 / scale }}
            >
              {`↑ ${(jumpHeight.heightFraction * 100).toFixed(0)}%`}
            </text>
          </g>
        )}
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
          <span>
            {`Pose ${status === 'loading' ? 'loading' : 'live'} · ${(activeModel ?? modelVariant).toUpperCase()} · ${delegate ?? '...'} · ${inferenceFps.toFixed(1)} fps · poses:${poseCount} · lm:${landmarkCount} vis:${visibleLandmarkCount}`}
          </span>
        )}
      </div>
    </div>
  );
}
