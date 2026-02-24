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
  findClosestPoseFrame,
  loadPoseAnalysisCache,
  savePoseAnalysisCache,
  type CachedPoseFrame,
  type PoseAnalysisCacheKey,
} from '@/lib/pose/pose-analysis-cache';
import { useToast } from '@/hooks/use-toast';

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
  usePreprocessCache: boolean;
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
  usePreprocessCache,
  useYoloMultiPerson,
  minPoseDetectionConfidence,
  minPosePresenceConfidence,
  minTrackingConfidence,
}: UsePoseLandmarksParams): UsePoseLandmarksResult {
  const { toast } = useToast();
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
  const preprocessToastShownRef = useRef<Set<string>>(new Set());

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
      setAnalysisStatus('idle');
      setAnalysisProgress(0);
      setAnalysisEtaSec(null);
      // Reset smoothing
      filterStatesRef.current = [];
      lastMediaTimeMsRef.current = -1;
      monotonicTimeMsRef.current = 0;
      cachedFramesRef.current = null;
      cacheIdRef.current = null;
      return;
    }

    if (!runtimeRef.current) {
      runtimeRef.current = createPoseRuntime();
      filterStatesRef.current = [];
      lastMediaTimeMsRef.current = -1;
      monotonicTimeMsRef.current = 0;
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
    const shouldUsePreprocess = Boolean(usePreprocessCache && isYoloModel && videoId);

    const trimStartMs = Math.max(0, Math.floor((Number.isFinite(trimStartSec) ? trimStartSec : 0) * 1000));
    const resolvedTrimEndSec = Number.isFinite(trimEndSec)
      ? Math.max(trimStartSec, trimEndSec ?? trimStartSec)
      : (Number.isFinite(videoElement.duration) && videoElement.duration > 0
        ? videoElement.duration
        : trimStartSec);
    const trimEndMs = Math.max(trimStartMs, Math.floor(resolvedTrimEndSec * 1000));

    const cacheKey: PoseAnalysisCacheKey | null = shouldUsePreprocess && videoId
      ? {
        videoId,
        modelVariant,
        targetFps,
        yoloMultiPerson: useYoloMultiPerson,
        trimStartMs,
        trimEndMs,
      }
      : null;

    let analysisReady = !shouldUsePreprocess;
    let analysisFailed = false;
    let analysisPromise: Promise<void> | null = null;

    setStatus('loading');
    setError(null);
    if (!shouldUsePreprocess) {
      setAnalysisStatus('idle');
      setAnalysisProgress(0);
      setAnalysisEtaSec(null);
    }

    const seekVideo = (timeSec: number) =>
      new Promise<void>((resolve) => {
        const clampedTime = Math.max(0, timeSec);
        let resolved = false;
        const cleanup = () => {
          videoElement.removeEventListener('seeked', onSeeked);
        };
        const finish = () => {
          if (resolved) return;
          resolved = true;
          cleanup();
          resolve();
        };
        const onSeeked = () => finish();

        videoElement.addEventListener('seeked', onSeeked);
        videoElement.currentTime = clampedTime;

        if (Math.abs(videoElement.currentTime - clampedTime) < 0.001) {
          queueMicrotask(finish);
          return;
        }

        window.setTimeout(finish, 250);
      });

    const ensureCachedAnalysis = async () => {
      if (!shouldUsePreprocess || !cacheKey) {
        setAnalysisStatus('idle');
        setAnalysisProgress(0);
        setAnalysisEtaSec(null);
        return;
      }
      if (cacheIdRef.current === buildPoseAnalysisCacheId(cacheKey) && cachedFramesRef.current) {
        analysisReady = true;
        setAnalysisStatus('ready');
        setAnalysisProgress(1);
        setAnalysisEtaSec(null);
        return;
      }
      if (analysisPromise) {
        await analysisPromise;
        return;
      }

      analysisPromise = (async () => {
        const cacheId = buildPoseAnalysisCacheId(cacheKey);
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

        const clipDurationSec = Math.max(0, (trimEndMs - trimStartMs) / 1000);
        if (clipDurationSec > 3 && !preprocessToastShownRef.current.has(cacheId)) {
          preprocessToastShownRef.current.add(cacheId);
          toast({
            title: 'Pose preprocessing started',
            description: `Long clip (${clipDurationSec.toFixed(1)}s). Processing may take a bit; overlay shows progress and seconds left.`,
            duration: 5000,
          });
        }

        const wasPaused = videoElement.paused;
        const originalTime = Number.isFinite(videoElement.currentTime)
          ? videoElement.currentTime
          : trimStartMs / 1000;
        const originalPlaybackRate = videoElement.playbackRate;

        // Analysis pass: prefer decoded-frame traversal; fallback to deterministic seek stepping.
        const analysisFrames: CachedPoseFrame[] = [];
        let previousMediaMs = -1;
        let analysisTimestampMs = 0;
        const stepMs = Math.max(1, Math.round(1000 / Math.max(1, targetFps)));
        const totalSteps = Math.max(1, Math.floor((trimEndMs - trimStartMs) / stepMs) + 1);
        let processedSteps = 0;
        const analysisStartMs = performance.now();

        const appendAnalysisFrame = (currentMediaMs: number, detectedPoses: NormalizedLandmark[][]) => {
          const previousFrame = analysisFrames[analysisFrames.length - 1];
          if (previousFrame && previousFrame.timestampMs === currentMediaMs) {
            previousFrame.poses = detectedPoses;
          } else {
            analysisFrames.push({
              timestampMs: currentMediaMs,
              poses: detectedPoses,
            });
          }
        };

        const updateAnalysisProgress = (currentMediaMs: number) => {
          const progress = Math.max(
            0,
            Math.min(1, (currentMediaMs - trimStartMs) / Math.max(1, trimEndMs - trimStartMs))
          );
          setAnalysisProgress(progress);
          if (progress <= 0.0001) {
            setAnalysisEtaSec(null);
            return;
          }
          const elapsedSec = Math.max(0.001, (performance.now() - analysisStartMs) / 1000);
          const etaSec = Math.max(0, (elapsedSec * (1 - progress)) / progress);
          setAnalysisEtaSec(etaSec);
        };

        const runStepSamplingAnalysis = async () => {
          for (let mediaMs = trimStartMs; mediaMs <= trimEndMs; mediaMs += stepMs) {
            if (cancelled) {
              return;
            }
            const seekTimeSec = mediaMs / 1000;
            await seekVideo(seekTimeSec);

            const currentMediaMs = Math.max(trimStartMs, Math.floor(videoElement.currentTime * 1000));
            const dtMs = previousMediaMs >= 0
              ? Math.max(1, currentMediaMs - previousMediaMs)
              : Math.max(1, stepMs);
            analysisTimestampMs += dtMs;
            previousMediaMs = currentMediaMs;

            const result = await runtime.detectForVideo(videoElement, analysisTimestampMs, config);
            const detectedPoses = result?.landmarks ?? [];
            appendAnalysisFrame(currentMediaMs, detectedPoses);

            processedSteps += 1;
            const progress = Math.max(0, Math.min(1, processedSteps / totalSteps));
            setAnalysisProgress(progress);
            const elapsedSec = Math.max(0.001, (performance.now() - analysisStartMs) / 1000);
            const etaSec = processedSteps > 0
              ? Math.max(0, (elapsedSec / processedSteps) * (totalSteps - processedSteps))
              : null;
            setAnalysisEtaSec(etaSec);
          }
        };

        const runFrameAccurateAnalysis = async () => {
          if (!videoWithCallback.requestVideoFrameCallback) {
            await runStepSamplingAnalysis();
            return;
          }

          await seekVideo(trimStartMs / 1000);

          await new Promise<void>((resolve, reject) => {
            let settled = false;
            let frameHandle: number | null = null;

            const finish = (error?: unknown) => {
              if (settled) return;
              settled = true;
              if (frameHandle !== null && videoWithCallback.cancelVideoFrameCallback) {
                videoWithCallback.cancelVideoFrameCallback(frameHandle);
              }
              videoElement.pause();
              if (error) {
                reject(error);
                return;
              }
              resolve();
            };

            const queueNextFrame = () => {
              if (settled || cancelled) {
                finish();
                return;
              }
              if (!videoWithCallback.requestVideoFrameCallback) {
                finish(new Error('requestVideoFrameCallback is unavailable during frame-accurate preprocessing.'));
                return;
              }
              frameHandle = videoWithCallback.requestVideoFrameCallback(onFrame);
              videoElement.play().catch((playError) => {
                finish(playError);
              });
            };

            const onFrame: VideoFrameCallback = async (_now, metadata) => {
              if (settled || cancelled) {
                finish();
                return;
              }

              const currentMediaMs = Math.max(trimStartMs, Math.floor(metadata.mediaTime * 1000));
              if (currentMediaMs < trimStartMs) {
                queueNextFrame();
                return;
              }
              if (currentMediaMs > trimEndMs + 1) {
                finish();
                return;
              }
              if (previousMediaMs >= 0 && currentMediaMs <= previousMediaMs) {
                if (currentMediaMs >= trimEndMs) {
                  finish();
                } else {
                  queueNextFrame();
                }
                return;
              }

              const dtMs = previousMediaMs >= 0
                ? Math.max(1, currentMediaMs - previousMediaMs)
                : Math.max(1, stepMs);
              analysisTimestampMs += dtMs;
              previousMediaMs = currentMediaMs;

              videoElement.pause();

              try {
                const result = await runtime.detectForVideo(videoElement, analysisTimestampMs, config);
                const detectedPoses = result?.landmarks ?? [];
                appendAnalysisFrame(currentMediaMs, detectedPoses);
                updateAnalysisProgress(currentMediaMs);
              } catch (frameError) {
                finish(frameError);
                return;
              }

              if (currentMediaMs >= trimEndMs) {
                finish();
                return;
              }

              queueNextFrame();
            };

            queueNextFrame();
          });
        };

        try {
          videoElement.pause();
          videoElement.playbackRate = 1;
          runtime.resetTracker();
          await runFrameAccurateAnalysis();

          if (analysisFrames.length === 0) {
            throw new Error('Pose preprocessing produced no frames.');
          }

          await savePoseAnalysisCache(cacheKey, analysisFrames);
          cachedFramesRef.current = analysisFrames;
          analysisReady = true;
          setAnalysisStatus('ready');
          setAnalysisProgress(1);
          setAnalysisEtaSec(0);
        } finally {
          videoElement.playbackRate = originalPlaybackRate;
          await seekVideo(originalTime);
          if (!wasPaused) {
            videoElement.play().catch(() => { });
          }
        }
      })();

      try {
        await analysisPromise;
      } catch (analysisError) {
        console.warn('[PoseAnalysis] Falling back to live inference after preprocessing failure.', analysisError);
        analysisFailed = true;
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
      if (cancelled || hasFatalError || !videoElement || isBusyRef.current) return;
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
        let detectedPoses: NormalizedLandmark[][] = [];
        let detectedWorldPoses: NormalizedLandmark[][] = [];

        if (shouldUsePreprocess && !analysisFailed) {
          if (!analysisReady) {
            await ensureCachedAnalysis();
          }
          if (cancelled) return;

          const cachedFrames = cachedFramesRef.current;
          if (cachedFrames && cachedFrames.length > 0) {
            const cachedFrame = findClosestPoseFrame(cachedFrames, currentMediaTimeMs);
            detectedPoses = cachedFrame?.poses ?? [];
            detectedWorldPoses = [];
          } else {
            analysisFailed = true;
          }
        }

        if (!shouldUsePreprocess || analysisFailed) {
          if (shouldUsePreprocess && analysisFailed) {
            setAnalysisStatus('error');
            setAnalysisEtaSec(null);
          } else {
            setAnalysisStatus('idle');
            setAnalysisProgress(0);
            setAnalysisEtaSec(null);
          }
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
    trimEndSec,
    trimStartSec,
    targetFps,
    useExactFrameSync,
    usePreprocessCache,
    useSmoothing,
    useYoloMultiPerson,
    videoId,
    videoElement,
    toast,
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
