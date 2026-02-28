'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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

type LimbKey = 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg' | 'torso' | 'head';

const LIMB_BASE_COLORS: Record<LimbKey, string> = {
  leftArm: '#3b82f6',
  rightArm: '#f59e0b',
  leftLeg: '#22c55e',
  rightLeg: '#a855f7',
  torso: '#06b6d4',
  head: '#94a3b8',
};

const ALERT_COLOR = '#ef4444';
const DEFAULT_LINE_COLOR = '#14b8a6';
const DEFAULT_POINT_FILL = '#f8fafc';
const DEFAULT_POINT_STROKE = '#0f766e';
const SKELETON_LINE_STROKE_WIDTH = 4;

const HEAD_LANDMARKS = new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const LEFT_ARM_LANDMARKS = new Set([11, 13, 15, 17, 19, 21]);
const RIGHT_ARM_LANDMARKS = new Set([12, 14, 16, 18, 20, 22]);
const LEFT_LEG_LANDMARKS = new Set([23, 25, 27, 29, 31]);
const RIGHT_LEG_LANDMARKS = new Set([24, 26, 28, 30, 32]);

const connectionKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

const CONNECTION_LIMB_MAP: Record<string, LimbKey> = {
  [connectionKey(0, 1)]: 'head',
  [connectionKey(1, 2)]: 'head',
  [connectionKey(2, 3)]: 'head',
  [connectionKey(3, 7)]: 'head',
  [connectionKey(0, 4)]: 'head',
  [connectionKey(4, 5)]: 'head',
  [connectionKey(5, 6)]: 'head',
  [connectionKey(6, 8)]: 'head',
  [connectionKey(9, 10)]: 'head',
  [connectionKey(11, 12)]: 'torso',
  [connectionKey(11, 23)]: 'torso',
  [connectionKey(12, 24)]: 'torso',
  [connectionKey(23, 24)]: 'torso',
  [connectionKey(11, 13)]: 'leftArm',
  [connectionKey(13, 15)]: 'leftArm',
  [connectionKey(15, 17)]: 'leftArm',
  [connectionKey(15, 19)]: 'leftArm',
  [connectionKey(15, 21)]: 'leftArm',
  [connectionKey(17, 19)]: 'leftArm',
  [connectionKey(12, 14)]: 'rightArm',
  [connectionKey(14, 16)]: 'rightArm',
  [connectionKey(16, 18)]: 'rightArm',
  [connectionKey(16, 20)]: 'rightArm',
  [connectionKey(16, 22)]: 'rightArm',
  [connectionKey(18, 20)]: 'rightArm',
  [connectionKey(23, 25)]: 'leftLeg',
  [connectionKey(25, 27)]: 'leftLeg',
  [connectionKey(27, 29)]: 'leftLeg',
  [connectionKey(29, 31)]: 'leftLeg',
  [connectionKey(27, 31)]: 'leftLeg',
  [connectionKey(24, 26)]: 'rightLeg',
  [connectionKey(26, 28)]: 'rightLeg',
  [connectionKey(28, 30)]: 'rightLeg',
  [connectionKey(30, 32)]: 'rightLeg',
  [connectionKey(28, 32)]: 'rightLeg',
};

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const hexToRgb = (hex: string): Rgb => {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3
    ? clean.split('').map((ch) => `${ch}${ch}`).join('')
    : clean;
  const parsed = Number.parseInt(full, 16);
  if (!Number.isFinite(parsed)) {
    return { r: 255, g: 255, b: 255 };
  }
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  };
};

const toHex = (value: number) => Math.round(clamp01(value / 255) * 255).toString(16).padStart(2, '0');

const blendHexColor = (startHex: string, endHex: string, amount: number) => {
  const t = clamp01(amount);
  const start = hexToRgb(startHex);
  const end = hexToRgb(endHex);
  const r = start.r + (end.r - start.r) * t;
  const g = start.g + (end.g - start.g) * t;
  const b = start.b + (end.b - start.b) * t;
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const getPointLimb = (index: number): LimbKey | null => {
  if (LEFT_ARM_LANDMARKS.has(index)) return 'leftArm';
  if (RIGHT_ARM_LANDMARKS.has(index)) return 'rightArm';
  if (LEFT_LEG_LANDMARKS.has(index)) return 'leftLeg';
  if (RIGHT_LEG_LANDMARKS.has(index)) return 'rightLeg';
  if (HEAD_LANDMARKS.has(index)) return 'head';
  return null;
};

const getConnectionLimb = (fromIndex: number, toIndex: number): LimbKey | null =>
  CONNECTION_LIMB_MAP[connectionKey(fromIndex, toIndex)] ?? null;

const hasVisibility = (point: ProjectedPoint | undefined, threshold = 0.1): point is ProjectedPoint =>
  Boolean(point && point.visibility >= threshold);

const computeAngleDegrees = (
  a: ProjectedPoint | undefined,
  b: ProjectedPoint | undefined,
  c: ProjectedPoint | undefined
) => {
  if (!hasVisibility(a) || !hasVisibility(b) || !hasVisibility(c)) return null;
  const baX = a.x - b.x;
  const baY = a.y - b.y;
  const bcX = c.x - b.x;
  const bcY = c.y - b.y;
  const dot = baX * bcX + baY * bcY;
  const magBA = Math.hypot(baX, baY);
  const magBC = Math.hypot(bcX, bcY);
  if (magBA < 1e-5 || magBC < 1e-5) return null;
  const cosAngle = Math.max(-1, Math.min(1, dot / (magBA * magBC)));
  return Math.acos(cosAngle) * (180 / Math.PI);
};

const computeLegSpreadDegrees = (pose: ProjectedPoint[]) => {
  const leftHip = pose[23];
  const rightHip = pose[24];
  const leftKnee = pose[25];
  const rightKnee = pose[26];
  if (!hasVisibility(leftHip) || !hasVisibility(rightHip) || !hasVisibility(leftKnee) || !hasVisibility(rightKnee)) {
    return null;
  }

  const pelvis = {
    x: (leftHip.x + rightHip.x) / 2,
    y: (leftHip.y + rightHip.y) / 2,
    visibility: Math.min(leftHip.visibility, rightHip.visibility),
  };
  return computeAngleDegrees(leftKnee, pelvis, rightKnee);
};

const computeTorsoLeanDegrees = (pose: ProjectedPoint[]) => {
  const leftShoulder = pose[11];
  const rightShoulder = pose[12];
  const leftHip = pose[23];
  const rightHip = pose[24];
  if (!hasVisibility(leftShoulder) || !hasVisibility(rightShoulder) || !hasVisibility(leftHip) || !hasVisibility(rightHip)) {
    return null;
  }
  const shoulderMidX = (leftShoulder.x + rightShoulder.x) / 2;
  const shoulderMidY = (leftShoulder.y + rightShoulder.y) / 2;
  const hipMidX = (leftHip.x + rightHip.x) / 2;
  const hipMidY = (leftHip.y + rightHip.y) / 2;
  const dx = shoulderMidX - hipMidX;
  const dy = hipMidY - shoulderMidY;
  return Math.abs(Math.atan2(dx, dy) * (180 / Math.PI));
};

const computeBandStrain = (angleDeg: number | null, minSafeDeg: number, maxSafeDeg: number) => {
  if (angleDeg === null) return 0;
  if (angleDeg < minSafeDeg) {
    return clamp01((minSafeDeg - angleDeg) / Math.max(1, minSafeDeg));
  }
  if (angleDeg > maxSafeDeg) {
    return clamp01((angleDeg - maxSafeDeg) / Math.max(1, 180 - maxSafeDeg));
  }
  return 0;
};

const computeUpperStrain = (value: number | null, startDeg: number, maxDeg: number) => {
  if (value === null) return 0;
  if (value <= startDeg) return 0;
  return clamp01((value - startDeg) / Math.max(1, maxDeg - startDeg));
};

const computeLimbStrain = (pose: ProjectedPoint[]): Record<LimbKey, number> => {
  const leftElbow = computeAngleDegrees(pose[11], pose[13], pose[15]);
  const rightElbow = computeAngleDegrees(pose[12], pose[14], pose[16]);
  const leftHip = computeAngleDegrees(pose[11], pose[23], pose[25]);
  const rightHip = computeAngleDegrees(pose[12], pose[24], pose[26]);
  const leftKnee = computeAngleDegrees(pose[23], pose[25], pose[27]);
  const rightKnee = computeAngleDegrees(pose[24], pose[26], pose[28]);
  const legSpread = computeLegSpreadDegrees(pose);
  const torsoLean = computeTorsoLeanDegrees(pose);

  const leftArmStrain = computeBandStrain(leftElbow, 30, 165);
  const rightArmStrain = computeBandStrain(rightElbow, 30, 165);
  const leftHipStrain = computeBandStrain(leftHip, 50, 165);
  const rightHipStrain = computeBandStrain(rightHip, 50, 165);
  const leftKneeStrain = computeBandStrain(leftKnee, 30, 170);
  const rightKneeStrain = computeBandStrain(rightKnee, 30, 170);
  const spreadStrain = computeUpperStrain(legSpread, 75, 135);
  const torsoLeanStrain = computeUpperStrain(torsoLean, 20, 45);

  return {
    leftArm: leftArmStrain,
    rightArm: rightArmStrain,
    leftLeg: Math.max(leftHipStrain, leftKneeStrain, spreadStrain),
    rightLeg: Math.max(rightHipStrain, rightKneeStrain, spreadStrain),
    torso: Math.max((leftHipStrain + rightHipStrain) / 2, spreadStrain, torsoLeanStrain),
    head: torsoLeanStrain * 0.6,
  };
};

const getLimbColor = (limb: LimbKey, strain: number) =>
  blendHexColor(LIMB_BASE_COLORS[limb], ALERT_COLOR, strain);


interface PoseOverlayProps {
  enabled: boolean;
  videoElement: HTMLVideoElement | null;
  scale: number;
  position: { x: number; y: number };
  objectFit: 'contain' | 'cover';
  modelVariant: PoseModelVariant;
  videoId: string | null;
  trimStartSec: number;
  trimEndSec: number | null;
  targetFps: number;
  useExactFrameSync: boolean;
  useSmoothing: boolean;
  useYoloMultiPerson: boolean;
  minVisibility: number;
  showCoG: boolean;
  showCoGCharts: boolean;
  showJointAngles: boolean;
  showBodyLean: boolean;
  showJumpHeight: boolean;
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

type CoGAxisKey = 'x' | 'y' | 'z';

interface CoGSample {
  tMs: number;
  x: number;
  y: number;
  z: number;
}

interface CoGSeriesPath {
  d: string;
  latest: number;
  min: number;
  max: number;
}

const COG_CHART_WINDOW_MS = 8000;
const COG_CHART_WIDTH = 260;
const COG_CHART_HEIGHT = 58;
const COG_CHARTS: Array<{ key: CoGAxisKey; label: string }> = [
  { key: 'x', label: 'X' },
  { key: 'y', label: 'Y' },
  { key: 'z', label: 'Z' },
];

const COG_DEPTH_INDICES = [11, 12, 23, 24] as const;

const buildCoGSeriesPath = (
  samples: CoGSample[],
  axis: CoGAxisKey,
  width: number,
  height: number
): CoGSeriesPath | null => {
  if (samples.length < 2) return null;
  const start = samples[0].tMs;
  const end = samples[samples.length - 1].tMs;
  const rangeT = Math.max(1, end - start);
  const values = samples.map((sample) => sample[axis]);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }

  if (Math.abs(max - min) < 1e-6) {
    min -= 0.5;
    max += 0.5;
  }
  const padding = (max - min) * 0.08;
  min -= padding;
  max += padding;
  const valueRange = Math.max(1e-6, max - min);

  const points = samples.map((sample) => {
    const tx = ((sample.tMs - start) / rangeT) * width;
    const ty = height - ((sample[axis] - min) / valueRange) * height;
    return `${tx.toFixed(2)},${ty.toFixed(2)}`;
  });

  return {
    d: `M ${points.join(' L ')}`,
    latest: values[values.length - 1],
    min,
    max,
  };
};

const computePoseDepth = (pose: NormalizedLandmark[] | null): number => {
  if (!pose || pose.length === 0) return 0;
  const preferredDepth = COG_DEPTH_INDICES
    .map((index) => pose[index]?.z)
    .filter((value): value is number => Number.isFinite(value));
  const fallbackDepth = pose
    .map((landmark) => landmark?.z)
    .filter((value): value is number => Number.isFinite(value));
  const candidates = preferredDepth.length > 0 ? preferredDepth : fallbackDepth;
  if (candidates.length === 0) return 0;
  const sum = candidates.reduce((acc, value) => acc + value, 0);
  return sum / candidates.length;
};

export default function PoseOverlay({
  enabled,
  videoElement,
  scale,
  position,
  objectFit,
  modelVariant,
  videoId,
  trimStartSec,
  trimEndSec,
  targetFps,
  useExactFrameSync,
  useSmoothing,
  useYoloMultiPerson,
  minVisibility,
  showCoG,
  showCoGCharts,
  showJointAngles,
  showBodyLean,
  showJumpHeight,
  minPoseDetectionConfidence,
  minPosePresenceConfidence,
  minTrackingConfidence,
}: PoseOverlayProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const jumpHeightStateRef = useRef<JumpHeightState>(createJumpHeightState());
  const [cogSamples, setCogSamples] = useState<CoGSample[]>([]);

  const {
    status,
    poses,
    error,
    inferenceFps,
    poseCount,
    mediaTimeMs,
    delegate,
    activeModel,
    analysisStatus,
    analysisProgress,
    analysisEtaSec,
  } = usePoseLandmarks({
    enabled,
    videoElement,
    modelVariant,
    videoId,
    trimStartSec,
    trimEndSec,
    targetFps,
    useExactFrameSync,
    useSmoothing,
    useYoloMultiPerson,
    minPoseDetectionConfidence,
    minPosePresenceConfidence,
    minTrackingConfidence,
  });

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

  // Always auto-select the most prominent pose
  const selectedPoseIndex = getAutoPoseIndex(projectedPoses);
  const selectedPose = selectedPoseIndex >= 0 ? projectedPoses[selectedPoseIndex] : null;
  const selectedRawPose = selectedPoseIndex >= 0 && selectedPoseIndex < poses.length
    ? poses[selectedPoseIndex]
    : null;
  const isYoloModel = modelVariant.startsWith('yolo');
  const analyzeEtaLabel = analysisEtaSec !== null
    ? `${Math.max(0, Math.ceil(analysisEtaSec))}s left`
    : null;
  const analysisModeLabel = analysisStatus === 'ready'
    ? 'cached'
    : analysisStatus === 'error' && isYoloModel
      ? 'cache-miss'
      : analysisStatus === 'analyzing'
    ? `analyzing ${Math.round(analysisProgress * 100)}%${analyzeEtaLabel ? ` · ${analyzeEtaLabel}` : ''}`
    : status === 'loading'
      ? 'loading'
      : 'live';
  const renderAllYoloPoses = isYoloModel && useYoloMultiPerson;
  const posesToRender = useMemo<ProjectedPoint[][]>(
    () => (renderAllYoloPoses ? projectedPoses : (selectedPose ? [selectedPose] : [])),
    [projectedPoses, renderAllYoloPoses, selectedPose]
  );
  const poseStrainProfiles = useMemo(
    () => posesToRender.map((pose) => computeLimbStrain(pose)),
    [posesToRender]
  );
  const selectedStrain = poseStrainProfiles[0] ?? null;
  const selectedBox = selectedPose
    ? getPoseBox(selectedPose, sourceWidth, sourceHeight)
    : null;
  const renderPoseBoxes = renderAllYoloPoses
    ? posesToRender
      .map((pose) => getPoseBox(pose, sourceWidth, sourceHeight))
      .filter((box): box is PoseBox => box !== null)
    : [];
  const drawPose = posesToRender.length > 0;
  const visibleLandmarkCount = selectedPose
    ? selectedPose.filter((point) => point.visibility >= minVisibility).length
    : 0;
  const landmarkCount = selectedPose?.length ?? 0;
  const preserveAspectRatio = objectFit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';

  // ── Biomechanics computations (only when individually enabled) ──
  const cog = useMemo(
    () => ((showCoG || showJumpHeight || showCoGCharts) && selectedPose ? computeCoG(selectedPose) : null),
    [selectedPose, showCoG, showCoGCharts, showJumpHeight]
  );
  const cogDepth = useMemo(() => computePoseDepth(selectedRawPose), [selectedRawPose]);
  const jointAngles = showJointAngles && selectedPose ? computeJointAngles(selectedPose) : [];
  const bodyLean = showBodyLean && selectedPose ? computeBodyLean(selectedPose) : null;
  const jumpHeight = showJumpHeight && cog
    ? updateJumpHeight(jumpHeightStateRef.current, cog, sourceHeight, mediaTimeMs)
    : null;

  const arcRadius = Math.max(16, sourceWidth * 0.025);
  const fontSize = Math.max(10, sourceWidth * 0.012);
  const limbLegendItems: Array<{ label: string; limb: LimbKey }> = [
    { label: 'L Arm', limb: 'leftArm' },
    { label: 'R Arm', limb: 'rightArm' },
    { label: 'L Leg', limb: 'leftLeg' },
    { label: 'R Leg', limb: 'rightLeg' },
  ];
  const cogChartSeries = useMemo<Record<CoGAxisKey, CoGSeriesPath | null>>(
    () => ({
      x: buildCoGSeriesPath(cogSamples, 'x', COG_CHART_WIDTH, COG_CHART_HEIGHT),
      y: buildCoGSeriesPath(cogSamples, 'y', COG_CHART_WIDTH, COG_CHART_HEIGHT),
      z: buildCoGSeriesPath(cogSamples, 'z', COG_CHART_WIDTH, COG_CHART_HEIGHT),
    }),
    [cogSamples]
  );

  useEffect(() => {
    if (!enabled) {
      setCogSamples([]);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !showCoGCharts || !cog) return;
    const normalizedX = sourceWidth > 0 ? cog.x / sourceWidth : 0;
    const normalizedY = sourceHeight > 0 ? cog.y / sourceHeight : 0;
    const sample: CoGSample = {
      tMs: mediaTimeMs,
      x: normalizedX,
      y: normalizedY,
      z: cogDepth,
    };

    setCogSamples((prev) => {
      if (prev.length === 0) return [sample];
      const last = prev[prev.length - 1];
      if (sample.tMs < last.tMs - 1) {
        // Loop/seek backwards: start a new timeline segment.
        return [sample];
      }
      if (Math.abs(sample.tMs - last.tMs) <= 1) {
        const unchanged = (
          Math.abs(last.x - sample.x) < 1e-6 &&
          Math.abs(last.y - sample.y) < 1e-6 &&
          Math.abs(last.z - sample.z) < 1e-6
        );
        if (unchanged) {
          return prev;
        }
        const next = [...prev];
        next[next.length - 1] = sample;
        return next;
      }
      const next = [...prev, sample];
      const cutoff = sample.tMs - COG_CHART_WINDOW_MS;
      while (next.length > 2 && next[0].tMs < cutoff) {
        next.shift();
      }
      return next;
    });
  }, [cog, cogDepth, enabled, mediaTimeMs, showCoGCharts, sourceHeight, sourceWidth]);

  if (!enabled) return null;

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
        {renderAllYoloPoses ? (
          renderPoseBoxes.map((box, index) => (
            <rect
              key={`pose-box-${index}`}
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              fill="none"
              stroke="#38bdf8"
              strokeOpacity={0.7}
              strokeWidth={1.7 / scale}
              vectorEffect="non-scaling-stroke"
            />
          ))
        ) : selectedBox ? (
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
        ) : null}

        {drawPose ? (
          <g style={{ mixBlendMode: 'overlay' }}>
            {posesToRender.map((pose, poseIndex) => {
              const poseVisibleLandmarkCount = pose.filter((point) => point.visibility >= minVisibility).length;
              const poseRelaxedVisibilityGate = poseVisibleLandmarkCount === 0;
              const strainProfile = poseStrainProfiles[poseIndex];
              return POSE_CONNECTIONS.map(([fromIndex, toIndex]) => {
                const from = pose[fromIndex];
                const to = pose[toIndex];
                if (!from || !to) return null;
                const lineGate = Math.min(minVisibility, 0.05);
                if (!poseRelaxedVisibilityGate && (from.visibility < lineGate || to.visibility < lineGate)) return null;
                const lineOpacity = poseRelaxedVisibilityGate
                  ? 0.55
                  : Math.max(0.35, Math.min(1, Math.min(from.visibility, to.visibility)));
                const limb = getConnectionLimb(fromIndex, toIndex);
                const limbStrain = limb && strainProfile ? strainProfile[limb] : 0;
                const strokeColor = limb ? getLimbColor(limb, limbStrain) : DEFAULT_LINE_COLOR;
                return (
                  <line
                    key={`pose-${poseIndex}-${fromIndex}-${toIndex}`}
                    x1={from.x}
                    y1={from.y}
                    x2={to.x}
                    y2={to.y}
                    stroke={strokeColor}
                    strokeOpacity={lineOpacity}
                    strokeWidth={SKELETON_LINE_STROKE_WIDTH / scale}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                );
              });
            })}

            {posesToRender.map((pose, poseIndex) => {
              const poseVisibleLandmarkCount = pose.filter((point) => point.visibility >= minVisibility).length;
              const poseRelaxedVisibilityGate = poseVisibleLandmarkCount === 0;
              const strainProfile = poseStrainProfiles[poseIndex];
              return pose.map((point, index) => {
                if (!poseRelaxedVisibilityGate && point.visibility < minVisibility) return null;
                const opacity = poseRelaxedVisibilityGate
                  ? Math.max(0.35, point.visibility || 0)
                  : 1;
                const limb = getPointLimb(index);
                const limbStrain = limb && strainProfile ? strainProfile[limb] : 0;
                const fillColor = limb ? getLimbColor(limb, limbStrain) : DEFAULT_POINT_FILL;
                const strokeColor = limb
                  ? blendHexColor(fillColor, '#020617', 0.28)
                  : DEFAULT_POINT_STROKE;
                return (
                  <circle
                    key={`pose-${poseIndex}-point-${index}`}
                    cx={point.x}
                    cy={point.y}
                    r={2.8 / scale}
                    fill={fillColor}
                    stroke={strokeColor}
                    fillOpacity={opacity}
                    strokeOpacity={opacity}
                    strokeWidth={1 / scale}
                    vectorEffect="non-scaling-stroke"
                  />
                );
              });
            })}
          </g>
        ) : null}

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
          const angleLimb: LimbKey | null = angle.label === 'L Elbow'
            ? 'leftArm'
            : angle.label === 'R Elbow'
              ? 'rightArm'
              : angle.label === 'L Knee' || angle.label === 'L Hip'
                ? 'leftLeg'
                : angle.label === 'R Knee' || angle.label === 'R Hip'
                  ? 'rightLeg'
                  : null;
          const angleColor = angleLimb && selectedStrain
            ? getLimbColor(angleLimb, selectedStrain[angleLimb])
            : 'rgba(255,255,255,0.85)';
          return (
            <g key={angle.label}>
              {/* Arc */}
              <path
                d={describeArc(angle.vertex.x, angle.vertex.y, arcRadius / scale, angle.startAngle, angle.sweepAngle)}
                fill="none"
                stroke={angleColor}
                strokeWidth={1.5 / scale}
                strokeOpacity={0.88}
                vectorEffect="non-scaling-stroke"
              />
              {/* Degree label */}
              <text
                x={labelPos.x}
                y={labelPos.y}
                fill={angleColor}
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

      {showCoGCharts && cogSamples.length >= 2 ? (
        <div className="absolute right-2 top-14 w-[320px] rounded-md border border-white/15 bg-black/45 p-2 backdrop-blur-sm">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/90">
            CoG Movement vs Time ({(COG_CHART_WINDOW_MS / 1000).toFixed(0)}s window)
          </div>
          <div className="space-y-1.5">
            {COG_CHARTS.map((axis) => {
              const series = cogChartSeries[axis.key];
              return (
                <div key={`cog-chart-${axis.key}`} className="flex items-center gap-2">
                  <div className="w-4 text-[11px] font-semibold uppercase text-white/80">{axis.label}</div>
                  <svg width={COG_CHART_WIDTH} height={COG_CHART_HEIGHT} className="rounded-sm bg-black/45">
                    <line
                      x1={0}
                      y1={COG_CHART_HEIGHT / 2}
                      x2={COG_CHART_WIDTH}
                      y2={COG_CHART_HEIGHT / 2}
                      stroke="rgba(255,255,255,0.18)"
                      strokeDasharray="3 3"
                    />
                    {series ? (
                      <>
                        <path
                          d={series.d}
                          fill="none"
                          stroke="rgba(255,255,255,0.92)"
                          strokeWidth={1.6}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <text
                          x={COG_CHART_WIDTH - 4}
                          y={12}
                          textAnchor="end"
                          fill="rgba(255,255,255,0.75)"
                          fontSize={10}
                          fontWeight={600}
                        >
                          {series.latest.toFixed(3)}
                        </text>
                      </>
                    ) : null}
                  </svg>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div
        className={cn(
          'absolute left-2 top-2 rounded-md px-2 py-1 text-[10px] font-semibold text-white/90 backdrop-blur-sm pointer-events-auto',
          status === 'error' ? 'bg-red-950/70' : 'bg-black/45'
        )}
      >
        {status === 'error' ? (
          `Pose error: ${error ?? 'unknown'}`
        ) : (
          <>
            <span>
              {`Pose ${analysisModeLabel} · ${(activeModel ?? modelVariant).toUpperCase()} · ${delegate ?? '...'} · ${inferenceFps.toFixed(1)} fps · poses:${poseCount} · lm:${landmarkCount} vis:${visibleLandmarkCount}`}
            </span>
            {drawPose ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-white/90">
                {limbLegendItems.map((item) => {
                  const color = selectedStrain
                    ? getLimbColor(item.limb, selectedStrain[item.limb])
                    : LIMB_BASE_COLORS[item.limb];
                  return (
                    <span key={`legend-${item.limb}`} className="inline-flex items-center gap-1">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span>{item.label}</span>
                    </span>
                  );
                })}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
