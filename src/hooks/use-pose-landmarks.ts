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
import {
  buildPoseAnalysisCacheId,
  findInterpolatedPosesAtTimestamp,
  loadPoseAnalysisCache,
  type CachedPoseFrame,
  type PoseAnalysisCacheKey,
} from '@/lib/pose/pose-analysis-cache';

type PoseStatus = 'idle' | 'loading' | 'ready' | 'error';
type AnalysisStatus = 'idle' | 'analyzing' | 'ready' | 'error';

interface UsePoseLandmarksParams {
  enabled: boolean;
  videoElement: HTMLVideoElement | null;
  modelVariant: PoseModelVariant;
  videoId: string | null;
  trimStartSec: number;
  trimEndSec: number | null;
  targetFps: number;
  useExactFrameSync: boolean;
  useSmoothing: boolean;
  useYoloMultiPerson: boolean;
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
  analysisStatus: AnalysisStatus;
  analysisProgress: number;
  analysisEtaSec: number | null;
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
}: UsePoseLandmarksParams): UsePoseLandmarksResult {
  const [status, setStatus] = useState<PoseStatus>('idle');
  const [poses, setPoses] = useState<NormalizedLandmark[][]>([]);
  const [worldPoses, setWorldPoses] = useState<NormalizedLandmark[][]>([]);
  const [error, setError] = useState<string | null>(null);
  const [inferenceFps, setInferenceFps] = useState(0);
  const [poseCount, setPoseCount] = useState(0);
  const [mediaTimeMs, setMediaTimeMs] = useState(0);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisEtaSec, setAnalysisEtaSec] = useState<number | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<PoseRuntimeSnapshot>({
    delegate: null,
    modelVariant: null,
  });

  const isBusyRef = useRef(false);
  const lastInferenceTimeRef = useRef(0);
  const fpsWindowStartRef = useRef(0);
  const fpsWindowFrameCountRef = useRef(0);
  const runtimeRef = useRef<PoseRuntime | null>(null);
  const cachedFramesRef = useRef<CachedPoseFrame[] | null>(null);
  const cacheIdRef = useRef<string | null>(null);

  // ── Smoothing state (lives here, NOT in render) ──
  const filterStatesRef = useRef<LandmarkFilterState[]>([]);
  const lastMediaTimeMsRef = useRef(-1);
  const monotonicTimeMsRef = useRef(0);
  const lastRenderedMediaTimeMsRef = useRef(-1);

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
      setAnalysisStatus('idle');
      setAnalysisProgress(0);
      setAnalysisEtaSec(null);
      // Reset smoothing
      filterStatesRef.current = [];
      lastMediaTimeMsRef.current = -1;
      monotonicTimeMsRef.current = 0;
      lastRenderedMediaTimeMsRef.current = -1;
      cachedFramesRef.current = null;
      cacheIdRef.current = null;
      return;
    }

    if (!runtimeRef.current) {
      runtimeRef.current = createPoseRuntime();
      filterStatesRef.current = [];
      lastMediaTimeMsRef.current = -1;
      monotonicTimeMsRef.current = 0;
      lastRenderedMediaTimeMsRef.current = -1;
      cachedFramesRef.current = null;
      cacheIdRef.current = null;
    }

    const runtime = runtimeRef.current;
    const config: PoseRuntimeConfig = {
      modelVariant,
      numPoses: 4,
      yoloMultiPerson: useYoloMultiPerson,
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
    const shouldUseCachedAnalysis = Boolean(isYoloModel && videoId);

    const trimStartMs = Math.max(0, Math.floor((Number.isFinite(trimStartSec) ? trimStartSec : 0) * 1000));
    const resolvedTrimEndSec = Number.isFinite(trimEndSec)
      ? Math.max(trimStartSec, trimEndSec ?? trimStartSec)
      : (Number.isFinite(videoElement.duration) && videoElement.duration > 0
        ? videoElement.duration
        : trimStartSec);
    const trimEndMs = Math.max(trimStartMs, Math.floor(resolvedTrimEndSec * 1000));

    const cacheKey: PoseAnalysisCacheKey | null = shouldUseCachedAnalysis && videoId
      ? {
        videoId,
        modelVariant,
        targetFps,
        yoloMultiPerson: useYoloMultiPerson,
        trimStartMs,
        trimEndMs,
      }
      : null;

    let analysisReady = !shouldUseCachedAnalysis;
    let analysisPromise: Promise<void> | null = null;

    setStatus('loading');
    setError(null);
    if (!shouldUseCachedAnalysis) {
      setAnalysisStatus('idle');
      setAnalysisProgress(0);
      setAnalysisEtaSec(null);
    }

    const ensureCachedAnalysis = async () => {
      if (!shouldUseCachedAnalysis || !cacheKey) {
        setAnalysisStatus('idle');
        setAnalysisProgress(0);
        setAnalysisEtaSec(null);
        return;
      }
      const nextCacheId = buildPoseAnalysisCacheId(cacheKey);
      if (cacheIdRef.current === nextCacheId && cachedFramesRef.current !== null) {
        analysisReady = true;
        const hasFrames = cachedFramesRef.current.length > 0;
        setAnalysisStatus(hasFrames ? 'ready' : 'error');
        setAnalysisProgress(hasFrames ? 1 : 0);
        setAnalysisEtaSec(hasFrames ? 0 : null);
        return;
      }
      if (analysisPromise) {
        await analysisPromise;
        return;
      }

      analysisPromise = (async () => {
        const cacheId = nextCacheId;
        cacheIdRef.current = cacheId;
        setAnalysisStatus('analyzing');
        setAnalysisProgress(0);
        setAnalysisEtaSec(null);

        const existing = await loadPoseAnalysisCache(cacheId);
        if (existing && existing.frames.length > 0) {
          cachedFramesRef.current = existing.frames;
          analysisReady = true;
          setAnalysisStatus('ready');
          setAnalysisProgress(1);
          setAnalysisEtaSec(null);
          return;
        }
        cachedFramesRef.current = null;
        analysisReady = true;
        cachedFramesRef.current = [];
        setAnalysisStatus('error');
        setAnalysisProgress(0);
        setAnalysisEtaSec(null);
      })();

      try {
        await analysisPromise;
      } catch (analysisError) {
        console.warn('[PoseAnalysis] Cached pose load failed.', analysisError);
        cachedFramesRef.current = null;
        setAnalysisStatus('error');
        setAnalysisProgress(0);
        setAnalysisEtaSec(null);
      } finally {
        analysisPromise = null;
      }
    };

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
      if (cancelled || hasFatalError || !videoElement) return;
      if (!force && document.hidden) return;
      if (videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (!force && videoElement.paused) return;

      if (!force) {
        const hasExactFrameMetadata = Boolean(useExactFrameSync && metadata);
        if (hasExactFrameMetadata && metadata) {
          if (metadata.mediaTime === lastProcessedMediaTime) return;
          // With requestVideoFrameCallback metadata we follow the actual decoded frame cadence.
          // This keeps timing tied to real media frames instead of a synthetic target interval.
          lastProcessedMediaTime = metadata.mediaTime;
        } else {
          if (now - lastInferenceTimeRef.current < targetInterval) return;
        }
      }

      // ── Compute media time (precise, not batched through React state) ──
      const currentMediaTimeMs = useExactFrameSync && metadata
        ? Math.floor(metadata.mediaTime * 1000)
        : Number.isFinite(videoElement.currentTime)
          ? Math.floor(videoElement.currentTime * 1000)
          : Math.floor(now);

      if (shouldUseCachedAnalysis && !force && currentMediaTimeMs === lastRenderedMediaTimeMsRef.current) {
        return;
      }

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
      lastRenderedMediaTimeMsRef.current = currentMediaTimeMs;

      if (!shouldUseCachedAnalysis) {
        if (isBusyRef.current) return;
        isBusyRef.current = true;
      }
      lastInferenceTimeRef.current = now;

      try {
        let detectedPoses: NormalizedLandmark[][] = [];
        let detectedWorldPoses: NormalizedLandmark[][] = [];

        if (shouldUseCachedAnalysis) {
          if (!analysisReady) {
            void ensureCachedAnalysis();
            return;
          }
          if (cancelled) return;

          const cachedFrames = cachedFramesRef.current;
          if (cachedFrames && cachedFrames.length > 0) {
            detectedPoses = findInterpolatedPosesAtTimestamp(cachedFrames, currentMediaTimeMs) ?? [];
            detectedWorldPoses = [];
            setAnalysisStatus('ready');
            setAnalysisProgress(1);
            setAnalysisEtaSec(0);
          } else if (modelVariant.startsWith('yolo')) {
            setStatus('error');
            setError('Pose cache not found. Process this clip from the Library first.');
            setPoses([]);
            setWorldPoses([]);
            setPoseCount(0);
            setInferenceFps(0);
            return;
          }
        }

        if (!shouldUseCachedAnalysis) {
          setAnalysisStatus('idle');
          setAnalysisProgress(0);
          setAnalysisEtaSec(null);
          const result = await runtime.detectForVideo(videoElement, timestampMs, config);
          detectedPoses = result?.landmarks ?? [];
          detectedWorldPoses = result?.worldLandmarks ?? [];
        }

        if (cancelled) return;
        setStatus('ready');
        setPoseCount(detectedPoses.length);

        if (!useSmoothing && filterStatesRef.current.length > 0) {
          filterStatesRef.current = [];
        }

        // ── Apply 1€ smoothing on normalized coords when enabled (including YOLO) ──
        if (useSmoothing && detectedPoses.length > 0 && dtMs > 0) {
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
        const snapshot = runtime.getSnapshot();
        setRuntimeSnapshot({
          delegate: snapshot.delegate,
          modelVariant: snapshot.modelVariant ?? modelVariant,
        });
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
          setAnalysisStatus((prev) => (prev === 'analyzing' ? 'error' : prev));
          setAnalysisEtaSec(null);
        }
      } finally {
        if (!shouldUseCachedAnalysis) {
          isBusyRef.current = false;
        }
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
      lastRenderedMediaTimeMsRef.current = -1;
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
    trimEndSec,
    trimStartSec,
    targetFps,
    useExactFrameSync,
    useSmoothing,
    useYoloMultiPerson,
    videoId,
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
      analysisStatus,
      analysisProgress,
      analysisEtaSec,
    }),
    [
      analysisEtaSec,
      analysisProgress,
      analysisStatus,
      error,
      inferenceFps,
      mediaTimeMs,
      poseCount,
      poses,
      runtimeSnapshot.delegate,
      runtimeSnapshot.modelVariant,
      status,
      worldPoses,
    ]
  );
}
