import type { Video } from '@/types';
import type { PoseRuntimeConfig } from '@/lib/pose/pose-runtime';
import { createPoseRuntime } from '@/lib/pose/pose-runtime';
import {
  savePoseAnalysisCache,
  type CachedPoseFrame,
  type PoseAnalysisCacheKey,
} from '@/lib/pose/pose-analysis-cache';

interface PosePreprocessJobOptions {
  video: Video;
  cacheKey: PoseAnalysisCacheKey;
  runtimeConfig: PoseRuntimeConfig;
  targetFps: number;
  signal?: AbortSignal;
  onProgress?: (progress: number, etaSec: number | null) => void;
}

const SEEK_TIMEOUT_MS = 400;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const formatError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return 'Pose preprocessing failed.';
};

const createAbortError = () => {
  const error = new Error('Pose preprocessing canceled.');
  error.name = 'AbortError';
  return error;
};

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) {
    throw createAbortError();
  }
};

const seekVideo = (videoElement: HTMLVideoElement, timeSec: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const clampedTime = Math.max(0, timeSec);
    if (Math.abs(videoElement.currentTime - clampedTime) < 0.001) {
      resolve();
      return;
    }

    let settled = false;
    let timeoutHandle: number | null = null;
    const cleanup = () => {
      videoElement.removeEventListener('seeked', onSeeked);
      signal?.removeEventListener('abort', onAbort);
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const failAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(createAbortError());
    };
    const onSeeked = () => finish();
    const onAbort = () => failAbort();

    videoElement.addEventListener('seeked', onSeeked, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    videoElement.currentTime = clampedTime;
    timeoutHandle = window.setTimeout(finish, SEEK_TIMEOUT_MS);
  });

type VideoFrameCallback = (now: number, metadata: VideoFrameCallbackMetadata) => void;
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: VideoFrameCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const waitForDecodedFrame = (videoElement: HTMLVideoElement, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const videoWithCallback = videoElement as VideoWithFrameCallback;
    if (videoWithCallback.requestVideoFrameCallback) {
      let settled = false;
      let handle: number | null = null;
      let timeoutHandle: number | null = null;
      const cleanup = () => {
        signal?.removeEventListener('abort', onAbort);
        if (handle !== null && videoWithCallback.cancelVideoFrameCallback) {
          videoWithCallback.cancelVideoFrameCallback(handle);
        }
        if (timeoutHandle !== null) {
          window.clearTimeout(timeoutHandle);
        }
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve();
      };
      const failAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(createAbortError());
      };
      const onAbort = () => failAbort();
      handle = videoWithCallback.requestVideoFrameCallback(() => finish());
      signal?.addEventListener('abort', onAbort, { once: true });
      timeoutHandle = window.setTimeout(finish, 100);
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const failAbort = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };
    const onAbort = () => failAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    requestAnimationFrame(() => finish());
  });

const waitForCanPlay = (videoElement: HTMLVideoElement, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    if (videoElement.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      resolve();
      return;
    }

    let settled = false;
    let timeoutHandle: number | null = null;
    const cleanup = () => {
      videoElement.removeEventListener('canplay', onCanPlay);
      videoElement.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
      }
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Unable to decode video for pose preprocessing.'));
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(createAbortError());
    };
    const onCanPlay = () => finish();
    const onError = () => fail();
    const onAbort = () => abort();

    videoElement.addEventListener('canplay', onCanPlay, { once: true });
    videoElement.addEventListener('error', onError, { once: true });
    signal?.addEventListener('abort', onAbort, { once: true });
    timeoutHandle = window.setTimeout(finish, 2500);
  });

const buildAnalysisRange = (video: Video, durationSec: number) => {
  const trimStartSec = Number.isFinite(video.trimStart) ? Math.max(0, video.trimStart ?? 0) : 0;
  const trimEndCandidate = Number.isFinite(video.trimEnd) ? video.trimEnd ?? trimStartSec : durationSec;
  const trimEndSec = Math.max(trimStartSec, Number.isFinite(trimEndCandidate) ? trimEndCandidate : trimStartSec);
  const trimStartMs = Math.max(0, Math.floor(trimStartSec * 1000));
  const trimEndMs = Math.max(trimStartMs, Math.floor(trimEndSec * 1000));
  return {
    trimStartSec,
    trimEndSec,
    trimStartMs,
    trimEndMs,
  };
};

export async function preprocessPoseVideoClip({
  video,
  cacheKey,
  runtimeConfig,
  targetFps,
  signal,
  onProgress,
}: PosePreprocessJobOptions): Promise<{ frameCount: number }> {
  const runtime = createPoseRuntime();
  const videoElement = document.createElement('video');
  const objectUrl = URL.createObjectURL(video.blob);
  const startedAt = performance.now();

  videoElement.preload = 'auto';
  videoElement.muted = true;
  videoElement.playsInline = true;
  videoElement.setAttribute('playsinline', '');
  videoElement.src = objectUrl;
  videoElement.style.position = 'fixed';
  videoElement.style.left = '-99999px';
  videoElement.style.top = '-99999px';
  videoElement.style.width = '1px';
  videoElement.style.height = '1px';
  videoElement.style.opacity = '0';
  document.body.appendChild(videoElement);

  try {
    throwIfAborted(signal);
    await waitForCanPlay(videoElement, signal);
    try {
      throwIfAborted(signal);
      await videoElement.play();
      videoElement.pause();
    } catch {
      // A short warm-up play can fail on some browsers without user gesture.
      // Seek-based preprocessing still works, so we ignore this.
    }

    const { trimStartSec, trimStartMs, trimEndMs } = buildAnalysisRange(
      video,
      Number.isFinite(videoElement.duration) ? videoElement.duration : video.duration
    );

    const stepMs = Math.max(1, Math.round(1000 / Math.max(1, targetFps)));
    const totalSteps = Math.max(1, Math.floor((trimEndMs - trimStartMs) / stepMs) + 1);

    const frames: CachedPoseFrame[] = [];
    let previousMediaMs = -1;
    let analysisTimestampMs = 0;
    let processedSteps = 0;

    for (let mediaMs = trimStartMs; mediaMs <= trimEndMs; mediaMs += stepMs) {
      throwIfAborted(signal);
      await seekVideo(videoElement, mediaMs / 1000, signal);
      await waitForDecodedFrame(videoElement, signal);
      throwIfAborted(signal);

      const currentMediaMs = Math.max(trimStartMs, Math.floor(videoElement.currentTime * 1000));
      const dtMs = previousMediaMs >= 0 ? Math.max(1, currentMediaMs - previousMediaMs) : Math.max(1, stepMs);
      analysisTimestampMs += dtMs;
      previousMediaMs = currentMediaMs;

      const result = await runtime.detectForVideo(videoElement, analysisTimestampMs, runtimeConfig);
      throwIfAborted(signal);
      const detectedPoses = result?.landmarks ?? [];
      const previousFrame = frames[frames.length - 1];
      if (previousFrame && previousFrame.timestampMs === currentMediaMs) {
        previousFrame.poses = detectedPoses;
      } else {
        frames.push({
          timestampMs: currentMediaMs,
          poses: detectedPoses,
        });
      }

      processedSteps += 1;
      const progress = clamp01(processedSteps / totalSteps);
      const elapsedSec = Math.max(0.001, (performance.now() - startedAt) / 1000);
      const etaSec = processedSteps > 0
        ? Math.max(0, (elapsedSec / processedSteps) * (totalSteps - processedSteps))
        : null;
      onProgress?.(progress, etaSec);
    }

    if (frames.length === 0) {
      throw new Error('Pose preprocessing produced no frames.');
    }

    await savePoseAnalysisCache(cacheKey, frames);

    // Ensure we end in-range for predictable downstream behavior if caller reuses this element.
    await seekVideo(videoElement, trimStartSec, signal);
    return { frameCount: frames.length };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error;
    }
    throw new Error(formatError(error));
  } finally {
    runtime.close();
    videoElement.pause();
    videoElement.removeAttribute('src');
    videoElement.load();
    videoElement.remove();
    URL.revokeObjectURL(objectUrl);
  }
}
