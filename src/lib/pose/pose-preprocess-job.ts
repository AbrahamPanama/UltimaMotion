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
  onProgress?: (progress: number, etaSec: number | null) => void;
}

const SEEK_TIMEOUT_MS = 400;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const formatError = (error: unknown) => {
  if (error instanceof Error) return error.message;
  return 'Pose preprocessing failed.';
};

const seekVideo = (videoElement: HTMLVideoElement, timeSec: number) =>
  new Promise<void>((resolve) => {
    const clampedTime = Math.max(0, timeSec);
    if (Math.abs(videoElement.currentTime - clampedTime) < 0.001) {
      resolve();
      return;
    }

    let settled = false;
    const cleanup = () => {
      videoElement.removeEventListener('seeked', onSeeked);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onSeeked = () => finish();

    videoElement.addEventListener('seeked', onSeeked, { once: true });
    videoElement.currentTime = clampedTime;
    window.setTimeout(finish, SEEK_TIMEOUT_MS);
  });

const waitForCanPlay = (videoElement: HTMLVideoElement) =>
  new Promise<void>((resolve, reject) => {
    if (videoElement.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      resolve();
      return;
    }

    let settled = false;
    const cleanup = () => {
      videoElement.removeEventListener('canplay', onCanPlay);
      videoElement.removeEventListener('error', onError);
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
    const onCanPlay = () => finish();
    const onError = () => fail();

    videoElement.addEventListener('canplay', onCanPlay, { once: true });
    videoElement.addEventListener('error', onError, { once: true });
    window.setTimeout(finish, 2500);
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
    await waitForCanPlay(videoElement);
    try {
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
      await seekVideo(videoElement, mediaMs / 1000);

      const currentMediaMs = Math.max(trimStartMs, Math.floor(videoElement.currentTime * 1000));
      const dtMs = previousMediaMs >= 0 ? Math.max(1, currentMediaMs - previousMediaMs) : Math.max(1, stepMs);
      analysisTimestampMs += dtMs;
      previousMediaMs = currentMediaMs;

      const result = await runtime.detectForVideo(videoElement, analysisTimestampMs, runtimeConfig);
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
    await seekVideo(videoElement, trimStartSec);
    return { frameCount: frames.length };
  } catch (error) {
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
