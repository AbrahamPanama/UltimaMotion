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

type PoseStatus = 'idle' | 'loading' | 'ready' | 'error';

interface UsePoseLandmarksParams {
  enabled: boolean;
  videoElement: HTMLVideoElement | null;
  modelVariant: PoseModelVariant;
  targetFps: number;
  minPoseDetectionConfidence: number;
  minPosePresenceConfidence: number;
  minTrackingConfidence: number;
}

interface UsePoseLandmarksResult {
  status: PoseStatus;
  poses: NormalizedLandmark[][];
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

const formatError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return 'Pose inference failed.';
};

export function usePoseLandmarks({
  enabled,
  videoElement,
  modelVariant,
  targetFps,
  minPoseDetectionConfidence,
  minPosePresenceConfidence,
  minTrackingConfidence,
}: UsePoseLandmarksParams): UsePoseLandmarksResult {
  const [status, setStatus] = useState<PoseStatus>('idle');
  const [poses, setPoses] = useState<NormalizedLandmark[][]>([]);
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
  const lastSubmittedTimestampMsRef = useRef(0);
  const fpsWindowStartRef = useRef(0);
  const fpsWindowFrameCountRef = useRef(0);
  const runtimeRef = useRef<PoseRuntime | null>(null);

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
      setError(null);
      setInferenceFps(0);
      setPoseCount(0);
      setMediaTimeMs(0);
      lastSubmittedTimestampMsRef.current = 0;
      return;
    }

    if (!runtimeRef.current) {
      runtimeRef.current = createPoseRuntime();
      lastSubmittedTimestampMsRef.current = 0;
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

    const runInference = async (now: number, force: boolean) => {
      if (cancelled || hasFatalError || !videoElement || isBusyRef.current) return;
      if (!force && document.hidden) return;
      if (videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (!force && videoElement.paused) return;
      if (!force && now - lastInferenceTimeRef.current < targetInterval) return;

      const mediaTimeMs = Number.isFinite(videoElement.currentTime)
        ? Math.floor(videoElement.currentTime * 1000)
        : Math.floor(now);
      setMediaTimeMs(mediaTimeMs);
      const candidateTs = mediaTimeMs;
      const previousTs = lastSubmittedTimestampMsRef.current;
      const timestampMs = candidateTs > previousTs ? candidateTs : previousTs + 1;
      lastSubmittedTimestampMsRef.current = timestampMs;

      isBusyRef.current = true;
      lastInferenceTimeRef.current = now;

      try {
        const result = await runtime.detectForVideo(videoElement, timestampMs, config);
        if (cancelled) return;
        setStatus('ready');
        const detectedPoses = result?.landmarks ?? [];
        setPoseCount(detectedPoses.length);
        setPoses(detectedPoses);
        trackFps(now);
        setRuntimeSnapshot(runtime.getSnapshot());
      } catch (inferenceError) {
        hasFatalError = true;
        if (!cancelled) {
          setStatus('error');
          setPoses([]);
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

    const videoFrameLoop: VideoFrameCallback = (now) => {
      if (cancelled) return;
      void runInference(now, false);
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

    const onSeeked = () => runImmediate();
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
    videoElement,
  ]);

  return useMemo(
    () => ({
      status,
      poses,
      error,
      inferenceFps,
      poseCount,
      mediaTimeMs,
      delegate: runtimeSnapshot.delegate,
      activeModel: runtimeSnapshot.modelVariant,
    }),
    [error, inferenceFps, mediaTimeMs, poseCount, poses, runtimeSnapshot.delegate, runtimeSnapshot.modelVariant, status]
  );
}
