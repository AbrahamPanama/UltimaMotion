import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { PoseModelVariant } from '@/types';
import {
  getPoseAnalysis,
  putPoseAnalysis,
  type PoseAnalysisRecord,
  type SerializedLandmark,
  type SerializedPose,
} from '@/lib/db';

export interface PoseAnalysisCacheKey {
  videoId: string;
  modelVariant: PoseModelVariant;
  targetFps: number;
  yoloMultiPerson: boolean;
  trimStartMs: number;
  trimEndMs: number;
}

export interface CachedPoseFrame {
  timestampMs: number;
  poses: NormalizedLandmark[][];
}

export interface CachedPoseAnalysis {
  id: string;
  frames: CachedPoseFrame[];
  createdAtMs: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export const buildPoseAnalysisCacheId = (key: PoseAnalysisCacheKey) =>
  [
    'posecache-v1',
    key.videoId,
    key.modelVariant,
    `fps${Math.max(1, Math.round(key.targetFps))}`,
    key.yoloMultiPerson ? 'multi1' : 'multi0',
    `s${key.trimStartMs}`,
    `e${key.trimEndMs}`,
  ].join('|');

const encodeLandmark = (landmark: NormalizedLandmark): SerializedLandmark => ([
  clamp01(Number.isFinite(landmark.x) ? landmark.x : 0),
  clamp01(Number.isFinite(landmark.y) ? landmark.y : 0),
  Number.isFinite(landmark.z ?? 0) ? landmark.z ?? 0 : 0,
  clamp01(Number.isFinite(landmark.visibility ?? 1) ? landmark.visibility ?? 1 : 0),
]);

const decodeLandmark = (tuple: SerializedLandmark): NormalizedLandmark => ({
  x: tuple[0],
  y: tuple[1],
  z: tuple[2],
  visibility: tuple[3],
});

const encodePoses = (poses: NormalizedLandmark[][]): SerializedPose[] =>
  poses.map((pose) => pose.map((landmark) => encodeLandmark(landmark)));

const decodePoses = (poses: SerializedPose[]): NormalizedLandmark[][] =>
  poses.map((pose) => pose.map((landmark) => decodeLandmark(landmark)));

export const loadPoseAnalysisCache = async (cacheId: string): Promise<CachedPoseAnalysis | null> => {
  const record = await getPoseAnalysis(cacheId);
  if (!record || !Array.isArray(record.frames)) {
    return null;
  }
  return {
    id: record.id,
    createdAtMs: record.createdAtMs,
    frames: record.frames.map((frame) => ({
      timestampMs: frame.t,
      poses: decodePoses(frame.poses),
    })),
  };
};

export const savePoseAnalysisCache = async (
  key: PoseAnalysisCacheKey,
  frames: CachedPoseFrame[]
) => {
  const id = buildPoseAnalysisCacheId(key);
  const normalizedFrames = frames
    .filter((frame) => Number.isFinite(frame.timestampMs) && frame.timestampMs >= 0)
    .sort((a, b) => a.timestampMs - b.timestampMs);

  const record: PoseAnalysisRecord = {
    id,
    videoId: key.videoId,
    modelVariant: key.modelVariant,
    targetFps: Math.max(1, Math.round(key.targetFps)),
    yoloMultiPerson: key.yoloMultiPerson,
    trimStartMs: key.trimStartMs,
    trimEndMs: key.trimEndMs,
    createdAtMs: Date.now(),
    frames: normalizedFrames.map((frame) => ({
      t: frame.timestampMs,
      poses: encodePoses(frame.poses),
    })),
  };

  await putPoseAnalysis(record);
  return id;
};

export const findClosestPoseFrame = (
  frames: CachedPoseFrame[],
  timestampMs: number
): CachedPoseFrame | null => {
  if (frames.length === 0) return null;
  if (timestampMs <= frames[0].timestampMs) return frames[0];
  const last = frames[frames.length - 1];
  if (timestampMs >= last.timestampMs) return last;

  let lo = 0;
  let hi = frames.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const midTime = frames[mid].timestampMs;
    if (midTime === timestampMs) {
      return frames[mid];
    }
    if (midTime < timestampMs) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  const upper = frames[Math.min(frames.length - 1, lo)];
  const lower = frames[Math.max(0, lo - 1)];
  if (!upper) return lower ?? null;
  if (!lower) return upper;
  return Math.abs(timestampMs - lower.timestampMs) <= Math.abs(upper.timestampMs - timestampMs) ? lower : upper;
};
