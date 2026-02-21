'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { PoseModelVariant } from '@/types';
import {
  createPoseRuntime,
  type PoseRuntime,
  type PoseDelegate,
  type PoseRuntimeConfig,
  type PoseRuntimeSnapshot,
} from '@/lib/pose/pose-runtime';
import {
  createOneEuroScalarState,
  updateOneEuroScalar,
  type OneEuroFilterParams,
  type OneEuroScalarState,
} from '@/lib/pose/one-euro-filter';

type PoseStatus = 'idle' | 'loading' | 'ready' | 'error';

interface UsePoseLandmarksParams {
  enabled: boolean;
  videoElement: HTMLVideoElement | null;
  modelVariant: PoseModelVariant;
  targetFps: number;
  useExactFrameSync: boolean;
  minPoseDetectionConfidence: number;
  minPosePresenceConfidence: number;
  minTrackingConfidence: number;
}

interface UsePoseLandmarksResult {
  status: PoseStatus;
  poses: NormalizedLandmark[][];
  worldPoses: NormalizedLandmark[][];
  error: string | null;
  inferenceFps: number;
  poseCount: number;
  mediaTimeMs: number;
  delegate: PoseDelegate | null;
  activeModel: PoseRuntimeSnapshot['modelVariant'];
}

type VideoFrameCallback = (now: number, metadata: VideoFrameCallbackMetadata) => void;
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: VideoFrameCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

// ── 1€ Filter params (expert-recommended for normalized [0,1] coordinates) ──
const ONE_EURO_PARAMS: OneEuroFilterParams = {
  minCutoff: 1.0,
  beta: 0.01,
  derivativeCutoff: 1.0,
};

interface LandmarkFilterState {
  xFilter: OneEuroScalarState;
  yFilter: OneEuroScalarState;
  zFilter: OneEuroScalarState;
  visFilter: OneEuroScalarState;
}

const createLandmarkFilterState = (): LandmarkFilterState => ({
  xFilter: createOneEuroScalarState(),
  yFilter: createOneEuroScalarState(),
  zFilter: createOneEuroScalarState(),
  visFilter: createOneEuroScalarState(),
});

/**
 * Apply the 1€ filter to a single pose's normalized landmarks.
 * Mutates filterStates in place for efficiency.
 */
const smoothNormalizedPose = (
  raw: NormalizedLandmark[],
  filterStates: LandmarkFilterState[],
  dtMs: number,
): NormalizedLandmark[] => {
  // Ensure filterStates array matches pose length
  while (filterStates.length < raw.length) {
    filterStates.push(createLandmarkFilterState());
  }

  return raw.map((lm, i) => {
    const state = filterStates[i];
    return {
      x: updateOneEuroScalar(state.xFilter, lm.x, dtMs, ONE_EURO_PARAMS),
      y: updateOneEuroScalar(state.yFilter, lm.y, dtMs, ONE_EURO_PARAMS),
      z: updateOneEuroScalar(state.zFilter, lm.z ?? 0, dtMs, ONE_EURO_PARAMS),
      visibility: updateOneEuroScalar(state.visFilter, lm.visibility ?? 1, dtMs, ONE_EURO_PARAMS),
    };
  });
};

const formatError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return 'Pose inference failed.';
};

export function usePoseLandmarks({
  enabled,
  videoElement,
  modelVariant,
  targetFps,
  useExactFrameSync,
  minPoseDetectionConfidence,
  minPosePresenceConfidence,
  minTrackingConfidence,
}: UsePoseLandmarksParams): UsePoseLandmarksResult {
  const [status, setStatus] = useState<PoseStatus>('idle');
  const [poses, setPoses] = useState<NormalizedLandmark[][]>([]);
  const [worldPoses, setWorldPoses] = useState<NormalizedLandmark[][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inferenceFps, setInferenceFps] = useState(0);
  const [poseCount, setPoseCount] = useState(0);
  const [mediaTimeMs, setMediaTimeMs] = useState(0);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<PoseRuntimeSnapshot>({
    delegate: null,
    modelVariant: null,
  });

  const isBusyRef = useRef(false);
  const lastInferenceTimeRef = useRef(0);
  const fpsWindowStartRef = useRef(0);
  const fpsWindowFrameCountRef = useRef(0);
  const runtimeRef = useRef<PoseRuntime | null>(null);

  // ── Smoothing state (lives here, NOT in render) ──
  const filterStatesRef = useRef<LandmarkFilterState[]>([]);
  const lastMediaTimeMsRef = useRef(-1);
  const monotonicTimeMsRef = useRef(0);

  useEffect(() => {
    return () => {
      runtimeRef.current?.close();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !videoElement) {
      runtimeRef.current?.close();
      runtimeRef.current = null;
      setStatus('idle');
      setPoses([]);
      setWorldPoses([]);
      setError(null);
      setInferenceFps(0);
      setPoseCount(0);
      setMediaTimeMs(0);
      // Reset smoothing
      filterStatesRef.current = [];
      lastMediaTimeMsRef.current = -1;
      monotonicTimeMsRef.current = 0;
      return;
    }

    if (!runtimeRef.current) {
      runtimeRef.current = createPoseRuntime();
      filterStatesRef.current = [];
      lastMediaTimeMsRef.current = -1;
      monotonicTimeMsRef.current = 0;
    }

    const runtime = runtimeRef.current;
    const config: PoseRuntimeConfig = {
      modelVariant,
      numPoses: 4,
      minPoseDetectionConfidence,
      minPosePresenceConfidence,
      minTrackingConfidence,
    };

    let cancelled = false;
    let hasFatalError = false;
    let rafHandle: number | null = null;
    let vfcHandle: number | null = null;

    const targetInterval = 1000 / Math.max(1, targetFps);
    const videoWithCallback = videoElement as VideoWithFrameCallback;
    const isYoloModel = modelVariant.startsWith('yolo');

    setStatus('loading');
    setError(null);

    const trackFps = (now: number) => {
      if (!fpsWindowStartRef.current) {
        fpsWindowStartRef.current = now;
      }
      fpsWindowFrameCountRef.current += 1;
      const elapsed = now - fpsWindowStartRef.current;
      if (elapsed >= 1000) {
        const fps = (fpsWindowFrameCountRef.current * 1000) / elapsed;
        setInferenceFps(Number.isFinite(fps) ? Number(fps.toFixed(1)) : 0);
        fpsWindowFrameCountRef.current = 0;
        fpsWindowStartRef.current = now;
      }
    };

    let lastProcessedMediaTime = -1;

    const runInference = async (now: number, force: boolean, metadata?: VideoFrameCallbackMetadata) => {
      if (cancelled || hasFatalError || !videoElement || isBusyRef.current) return;
      if (!force && document.hidden) return;
      if (videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (!force && videoElement.paused) return;

      if (!force) {
        if (useExactFrameSync && metadata) {
          if (metadata.mediaTime === lastProcessedMediaTime) return;
        }
        if (now - lastInferenceTimeRef.current < targetInterval) return;
        if (useExactFrameSync && metadata) {
          lastProcessedMediaTime = metadata.mediaTime;
        }
      }

      // ── Compute media time (precise, not batched through React state) ──
      const currentMediaTimeMs = useExactFrameSync && metadata
        ? Math.floor(metadata.mediaTime * 1000)
        : Number.isFinite(videoElement.currentTime)
          ? Math.floor(videoElement.currentTime * 1000)
          : Math.floor(now);

      // ── Compute dtMs for the 1€ filter ──
      let dtMs = lastMediaTimeMsRef.current >= 0
        ? currentMediaTimeMs - lastMediaTimeMsRef.current
        : 33; // reasonable default for first frame (~30fps)

      // Detect loop or seek (backwards jump or huge forward gap)
      const isLoopOrSeek = dtMs < 0 || dtMs > 1000;

      if (isLoopOrSeek) {
        dtMs = 33; // fallback
        runtime.resetTracker(); // flush MediaPipe's internal optical flow
        filterStatesRef.current = []; // flush 1€ filter history
      }

      lastMediaTimeMsRef.current = currentMediaTimeMs;

      // ── Build monotonic timestamp for MediaPipe ──
      monotonicTimeMsRef.current += Math.max(1, dtMs);
      const timestampMs = monotonicTimeMsRef.current;

      setMediaTimeMs(currentMediaTimeMs);

      isBusyRef.current = true;
      lastInferenceTimeRef.current = now;

      try {
        const result = await runtime.detectForVideo(videoElement, timestampMs, config);
        if (cancelled) return;
        setStatus('ready');
        const detectedPoses = result?.landmarks ?? [];
        const detectedWorldPoses = result?.worldLandmarks ?? [];
        setPoseCount(detectedPoses.length);

        // ── Apply 1€ smoothing on normalized coords (skip for YOLO) ──
        if (!isYoloModel && detectedPoses.length > 0 && dtMs > 0) {
          const smoothedPoses = detectedPoses.map((pose, poseIdx) => {
            // For simplicity, we only smooth the first pose with a shared filter state.
            // Multi-person smoothing would need per-tracked-person state.
            if (poseIdx === 0) {
              return smoothNormalizedPose(pose, filterStatesRef.current, dtMs);
            }
            return pose;
          });
          setPoses(smoothedPoses);
        } else {
          setPoses(detectedPoses);
        }

        setWorldPoses(detectedWorldPoses);
        trackFps(now);
        setRuntimeSnapshot(runtime.getSnapshot());
      } catch (inferenceError) {
        hasFatalError = true;
        if (!cancelled) {
          setStatus('error');
          setPoses([]);
          setWorldPoses([]);
          setError(formatError(inferenceError));
          setInferenceFps(0);
          setPoseCount(0);
          setMediaTimeMs(0);
        }
      } finally {
        isBusyRef.current = false;
      }
    };

    const frameLoop = (now: number) => {
      if (cancelled) return;
      void runInference(now, false);
      rafHandle = requestAnimationFrame(frameLoop);
    };

    const videoFrameLoop: VideoFrameCallback = (now, metadata) => {
      if (cancelled) return;
      void runInference(now, false, metadata);
      if (videoWithCallback.requestVideoFrameCallback) {
        vfcHandle = videoWithCallback.requestVideoFrameCallback(videoFrameLoop);
      }
    };

    const runImmediate = () => {
      void runInference(performance.now(), true);
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        runImmediate();
      }
    };

    const onSeeked = () => {
      // Reset smoothing on seek — user jumped to a different point
      runtime.resetTracker();
      filterStatesRef.current = [];
      lastMediaTimeMsRef.current = -1;
      runImmediate();
    };
    const onPause = () => runImmediate();
    const onPlay = () => runImmediate();
    const onLoadedData = () => runImmediate();

    document.addEventListener('visibilitychange', onVisibilityChange);
    videoElement.addEventListener('seeked', onSeeked);
    videoElement.addEventListener('pause', onPause);
    videoElement.addEventListener('play', onPlay);
    videoElement.addEventListener('loadeddata', onLoadedData);

    runImmediate();

    if (videoWithCallback.requestVideoFrameCallback) {
      vfcHandle = videoWithCallback.requestVideoFrameCallback(videoFrameLoop);
    } else {
      rafHandle = requestAnimationFrame(frameLoop);
    }

    return () => {
      cancelled = true;
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
      }
      if (vfcHandle !== null && videoWithCallback.cancelVideoFrameCallback) {
        videoWithCallback.cancelVideoFrameCallback(vfcHandle);
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      videoElement.removeEventListener('seeked', onSeeked);
      videoElement.removeEventListener('pause', onPause);
      videoElement.removeEventListener('play', onPlay);
      videoElement.removeEventListener('loadeddata', onLoadedData);
    };
  }, [
    enabled,
    minPoseDetectionConfidence,
    minPosePresenceConfidence,
    minTrackingConfidence,
    modelVariant,
    targetFps,
    useExactFrameSync,
    videoElement,
  ]);

  return useMemo(
    () => ({
      status,
      poses,
      worldPoses,
      error,
      inferenceFps,
      poseCount,
      mediaTimeMs,
      delegate: runtimeSnapshot.delegate,
      activeModel: runtimeSnapshot.modelVariant,
    }),
    [error, inferenceFps, mediaTimeMs, poseCount, poses, worldPoses, runtimeSnapshot.delegate, runtimeSnapshot.modelVariant, status]
  );
}
