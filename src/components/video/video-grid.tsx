'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { useAppContext } from '@/contexts/app-context';
import VideoTile from './video-tile';
import OverlayCompareTile from './overlay-compare-tile';
import { cn } from '@/lib/utils';
import PlayerControls from './player-controls';
import type { Video } from '@/types';
import { useIsMobile } from '@/hooks/use-mobile';

type ActiveVideoEntry = {
  video: HTMLVideoElement;
  index: number;
  slot: Video;
};

const DRIFT_SOFT_THRESHOLD_SEC = 1 / 120; // ~8ms
const DRIFT_HARD_THRESHOLD_SEC = 1 / 20; // 50ms
const MAX_RATE_CORRECTION = 0.08;
const SEEK_TIMEOUT_MS = 750;
const FALLBACK_FRAME_STEP_SEC = 1 / 30;
const MIN_FRAME_STEP_SEC = 1 / 240;
const MAX_FRAME_STEP_SEC = 1 / 12;

const clampPlaybackRate = (rate: number) => Math.max(0.1, Math.min(4, rate));

const seekVideoToTime = (video: HTMLVideoElement, targetTime: number) =>
  new Promise<void>((resolve) => {
    const safeTarget = Math.max(0, targetTime);
    if (Math.abs(video.currentTime - safeTarget) < 0.001) {
      resolve();
      return;
    }

    let done = false;
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
    };
    const finish = () => {
      if (done) return;
      done = true;
      cleanup();
      resolve();
    };
    const onSeeked = () => finish();

    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = safeTarget;
    window.setTimeout(finish, SEEK_TIMEOUT_MS);
  });

export default function VideoGrid() {
  const {
    layout,
    compareViewMode,
    canUseOverlayComparison,
    overlayOpacity,
    overlayBlendMode,
    overlayTopColorFilter,
    overlayTopBlackAndWhite,
    slots,
    setSlot,
    activeTileIndex,
    isSyncEnabled,
    isPortraitMode,
    videoRefs,
    isLoopEnabled,
    isMuted,
    syncOffsets,
    playbackRate,
    setPlaybackRate,
  } = useAppContext();
  const isMobile = useIsMobile();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const rafRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  const playbackRateRef = useRef(playbackRate);
  const syncBusyRef = useRef(false);
  const pendingSyncRef = useRef<{ relativeTime: number; resume: boolean; targetPlaybackRate: number } | null>(null);
  const frameStepSecRef = useRef(FALLBACK_FRAME_STEP_SEC);
  const frameObserverVideoRef = useRef<HTMLVideoElement | null>(null);
  const frameObserverHandleRef = useRef<number | null>(null);
  const lastObservedMediaTimeRef = useRef<number | null>(null);
  const overlayEntries = slots
    .map((slot, index) => ({ slot, index }))
    .filter((entry): entry is { slot: Video; index: number } => entry.slot !== null);
  const canRenderOverlay = compareViewMode === 'overlay' && canUseOverlayComparison && overlayEntries.length === 2;
  const isSharedPlaybackMode = isSyncEnabled || canRenderOverlay;

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    playbackRateRef.current = playbackRate;
  }, [playbackRate]);

  const getActiveVideos = useCallback((): ActiveVideoEntry[] => {
    return videoRefs.current
      .map((video, index) => ({ video, index, slot: slots[index] }))
      .filter((item): item is ActiveVideoEntry => item.video !== null && item.slot !== null);
  }, [videoRefs, slots]);

  const getFrameStepSec = useCallback(() => {
    const raw = frameStepSecRef.current;
    if (!Number.isFinite(raw)) return FALLBACK_FRAME_STEP_SEC;
    return Math.max(MIN_FRAME_STEP_SEC, Math.min(MAX_FRAME_STEP_SEC, raw));
  }, []);

  useEffect(() => {
    const previousVideo = frameObserverVideoRef.current;
    const previousHandle = frameObserverHandleRef.current;
    if (
      previousVideo &&
      previousHandle !== null &&
      typeof previousVideo.cancelVideoFrameCallback === 'function'
    ) {
      previousVideo.cancelVideoFrameCallback(previousHandle);
    }
    frameObserverVideoRef.current = null;
    frameObserverHandleRef.current = null;
    lastObservedMediaTimeRef.current = null;

    if (!isSharedPlaybackMode) return;

    const master = getActiveVideos()[0]?.video ?? null;
    if (
      !master ||
      typeof master.requestVideoFrameCallback !== 'function' ||
      typeof master.cancelVideoFrameCallback !== 'function'
    ) {
      return;
    }

    frameObserverVideoRef.current = master;

    const observeFrame: VideoFrameRequestCallback = (_now, metadata) => {
      if (frameObserverVideoRef.current !== master) return;
      const mediaTime = metadata.mediaTime;
      const prevMediaTime = lastObservedMediaTimeRef.current;
      if (prevMediaTime !== null) {
        const delta = mediaTime - prevMediaTime;
        if (Number.isFinite(delta) && delta >= MIN_FRAME_STEP_SEC && delta <= MAX_FRAME_STEP_SEC * 2) {
          frameStepSecRef.current = (frameStepSecRef.current * 0.8) + (delta * 0.2);
        }
      }
      lastObservedMediaTimeRef.current = mediaTime;
      frameObserverHandleRef.current = master.requestVideoFrameCallback(observeFrame);
    };

    frameObserverHandleRef.current = master.requestVideoFrameCallback(observeFrame);

    return () => {
      const observedVideo = frameObserverVideoRef.current;
      const observedHandle = frameObserverHandleRef.current;
      if (
        observedVideo &&
        observedHandle !== null &&
        typeof observedVideo.cancelVideoFrameCallback === 'function'
      ) {
        observedVideo.cancelVideoFrameCallback(observedHandle);
      }
      frameObserverVideoRef.current = null;
      frameObserverHandleRef.current = null;
      lastObservedMediaTimeRef.current = null;
    };
  }, [getActiveVideos, isSharedPlaybackMode]);

  const getTrimBounds = useCallback((slot: Video, video: HTMLVideoElement) => {
    const start = slot.trimStart ?? 0;
    const trimEnd = slot.trimEnd ?? video.duration;
    const end = Number.isFinite(trimEnd) ? trimEnd : start;
    return { start, end: Math.max(start, end) };
  }, []);

  const clampToTrim = useCallback(
    (time: number, slot: Video, video: HTMLVideoElement) => {
      const { start, end } = getTrimBounds(slot, video);
      return Math.max(start, Math.min(time, end));
    },
    [getTrimBounds]
  );

  const getSyncDuration = useCallback(() => {
    const active = getActiveVideos();
    if (active.length === 0) return 0;

    const durations = active
      .map(({ video, index, slot }) => {
        const { start, end } = getTrimBounds(slot, video);
        const offset = syncOffsets[index] || 0;
        const effectiveStart = clampToTrim(start + offset, slot, video);
        return Math.max(0, end - effectiveStart);
      })
      .filter((value) => value > 0);

    return durations.length ? Math.min(...durations) : 0;
  }, [clampToTrim, getActiveVideos, getTrimBounds, syncOffsets]);

  const getMasterRelativeTime = useCallback(
    (active: ActiveVideoEntry[]) => {
      const master = active[0];
      if (!master) return 0;
      const { start } = getTrimBounds(master.slot, master.video);
      const offset = syncOffsets[master.index] || 0;
      const masterStart = clampToTrim(start + offset, master.slot, master.video);
      return Math.max(0, master.video.currentTime - masterStart);
    },
    [clampToTrim, getTrimBounds, syncOffsets]
  );

  const syncToRelativeTime = useCallback(
    async (relativeTime: number, options?: { resume?: boolean; targetPlaybackRate?: number }) => {
      const requestedResume = options?.resume ?? isPlayingRef.current;
      const requestedPlaybackRate = clampPlaybackRate(options?.targetPlaybackRate ?? playbackRateRef.current);
      pendingSyncRef.current = {
        relativeTime,
        resume: requestedResume,
        targetPlaybackRate: requestedPlaybackRate,
      };

      if (syncBusyRef.current) return;
      syncBusyRef.current = true;

      try {
        while (pendingSyncRef.current) {
          const next = pendingSyncRef.current;
          pendingSyncRef.current = null;

          const active = getActiveVideos();
          if (active.length === 0) {
            setCurrentTime(0);
            setIsPlaying(false);
            continue;
          }

          const syncDuration = getSyncDuration();
          const clampedRelative =
            syncDuration > 0
              ? Math.max(0, Math.min(next.relativeTime, syncDuration))
              : Math.max(0, next.relativeTime);

          active.forEach(({ video }) => video.pause());

          await Promise.all(
            active.map(({ video, index, slot }) => {
              const { start } = getTrimBounds(slot, video);
              const offset = syncOffsets[index] || 0;
              const targetTime = clampToTrim(start + offset + clampedRelative, slot, video);
              return seekVideoToTime(video, targetTime);
            })
          );

          active.forEach(({ video, index, slot }) => {
            const { start } = getTrimBounds(slot, video);
            const offset = syncOffsets[index] || 0;
            const targetTime = clampToTrim(start + offset + clampedRelative, slot, video);
            if (Math.abs(video.currentTime - targetTime) >= 0.001) {
              video.currentTime = targetTime;
            }
            video.playbackRate = next.targetPlaybackRate;
          });

          setCurrentTime(clampedRelative);

          if (next.resume) {
            const playResults = await Promise.allSettled(
              active.map(({ video }) => video.play())
            );
            const hadPlayFailure = playResults.some((result) => result.status === 'rejected');
            if (hadPlayFailure) {
              active.forEach(({ video }) => video.pause());
              setIsPlaying(false);
              console.warn('[sync] Could not resume all videos after seek; kept playback paused to preserve sync.');
              continue;
            }
          }

          setIsPlaying(next.resume);
        }
      } finally {
        syncBusyRef.current = false;
      }
    },
    [clampToTrim, getActiveVideos, getSyncDuration, getTrimBounds, syncOffsets]
  );

  const tick = useCallback(() => {
    if (!isPlayingRef.current) return;

    const active = getActiveVideos();
    if (active.length === 0) {
      setIsPlaying(false);
      return;
    }

    const syncDuration = getSyncDuration();
    const masterRelative = getMasterRelativeTime(active);
    const clampedRelative =
      syncDuration > 0 ? Math.max(0, Math.min(masterRelative, syncDuration)) : Math.max(0, masterRelative);
    setCurrentTime(clampedRelative);

    if (isLoopEnabled && syncDuration > 0 && clampedRelative >= syncDuration - 0.001) {
      void syncToRelativeTime(0, { resume: true });
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    if (!syncBusyRef.current) {
      active.forEach((entry, idx) => {
        if (idx === 0) {
          entry.video.playbackRate = playbackRate;
          return;
        }

        const { video, index, slot } = entry;
        const { start } = getTrimBounds(slot, video);
        const offset = syncOffsets[index] || 0;
        const targetTime = clampToTrim(start + offset + clampedRelative, slot, video);
        const driftSec = video.currentTime - targetTime;
        const absDrift = Math.abs(driftSec);

        if (absDrift >= DRIFT_HARD_THRESHOLD_SEC) {
          video.currentTime = targetTime;
          video.playbackRate = playbackRate;
          return;
        }

        if (absDrift >= DRIFT_SOFT_THRESHOLD_SEC && !video.paused) {
          const correction = Math.max(
            -MAX_RATE_CORRECTION,
            Math.min(MAX_RATE_CORRECTION, -driftSec * 1.5)
          );
          video.playbackRate = clampPlaybackRate(playbackRate + correction);
          return;
        }

        if (video.playbackRate !== playbackRate) {
          video.playbackRate = playbackRate;
        }
      });
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [
    clampToTrim,
    getActiveVideos,
    getMasterRelativeTime,
    getSyncDuration,
    getTrimBounds,
    isLoopEnabled,
    playbackRate,
    syncOffsets,
    syncToRelativeTime,
  ]);

  useEffect(() => {
    if (isSharedPlaybackMode && isPlaying) {
      rafRef.current = requestAnimationFrame(tick);
    } else if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isSharedPlaybackMode, isPlaying, tick]);

  useEffect(() => {
    if (!isSharedPlaybackMode) return;
    setDuration(getSyncDuration());
  }, [getSyncDuration, isSharedPlaybackMode, slots]);

  const handlePlayPause = () => {
    const active = getActiveVideos();
    if (active.length === 0) return;

    if (isPlayingRef.current) {
      active.forEach(({ video }) => {
        video.pause();
        video.playbackRate = playbackRate;
      });
      setIsPlaying(false);
      return;
    }

    const masterRelative = getMasterRelativeTime(active);
    void syncToRelativeTime(masterRelative, { resume: true });
  };

  const handleSeek = (time: number) => {
    const syncDuration = getSyncDuration();
    const clampedTime =
      syncDuration > 0 ? Math.max(0, Math.min(time, syncDuration)) : Math.max(0, time);
    setCurrentTime(clampedTime);
    void syncToRelativeTime(clampedTime, {
      resume: isPlayingRef.current,
      targetPlaybackRate: playbackRateRef.current,
    });
  };

  const handleStepFrame = useCallback((direction: -1 | 1) => {
    const active = getActiveVideos();
    if (active.length === 0) return;

    const stepSec = getFrameStepSec();
    const syncDuration = getSyncDuration();
    const masterRelative = getMasterRelativeTime(active);
    const unclampedTime = masterRelative + (direction * stepSec);
    const nextTime =
      syncDuration > 0
        ? Math.max(0, Math.min(unclampedTime, syncDuration))
        : Math.max(0, unclampedTime);

    active.forEach(({ video }) => video.pause());
    setIsPlaying(false);
    setCurrentTime(nextTime);
    void syncToRelativeTime(nextTime, {
      resume: false,
      targetPlaybackRate: playbackRateRef.current,
    });
  }, [getActiveVideos, getFrameStepSec, getMasterRelativeTime, getSyncDuration, syncToRelativeTime]);

  const handleRateChange = (rate: number) => {
    const nextRate = clampPlaybackRate(rate);
    playbackRateRef.current = nextRate;
    setPlaybackRate(nextRate);

    const active = getActiveVideos();
    if (active.length === 0) {
      return;
    }

    const masterRelative = getMasterRelativeTime(active);
    void syncToRelativeTime(masterRelative, {
      resume: isPlayingRef.current,
      targetPlaybackRate: nextRate,
    });
  };

  const effectiveLayout = isMobile && layout === 4 ? 2 : layout;

  const gridClasses = {
    1: 'grid-cols-1',
    2: isMobile ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2',
    4: isMobile ? 'grid-cols-1' : 'grid-cols-2',
  };
  const gridClassName = canRenderOverlay ? 'grid-cols-1' : gridClasses[effectiveLayout];

  return (
    <div className="flex h-full flex-1 gap-4 overflow-hidden">
      <div className="flex h-full flex-1 flex-col gap-4 overflow-hidden">
        <div className={cn('grid flex-1 min-h-0 auto-rows-[1fr] gap-4', gridClassName)}>
          {canRenderOverlay ? (
            <div className="flex min-h-0 min-w-0 items-center justify-center overflow-hidden">
              <OverlayCompareTile
                baseVideo={overlayEntries[0].slot}
                topVideo={overlayEntries[1].slot}
                baseIndex={overlayEntries[0].index}
                topIndex={overlayEntries[1].index}
                videoRefs={videoRefs}
                isPortraitMode={isPortraitMode}
                isMuted={isMuted}
                overlayOpacity={overlayOpacity}
                overlayBlendMode={overlayBlendMode}
                overlayTopColorFilter={overlayTopColorFilter}
                overlayTopBlackAndWhite={overlayTopBlackAndWhite}
                onRemoveBase={() => setSlot(overlayEntries[0].index, null)}
                onRemoveTop={() => setSlot(overlayEntries[1].index, null)}
              />
            </div>
          ) : (
            slots.slice(0, effectiveLayout).map((video, index) => (
              <div key={index} className="flex min-h-0 min-w-0 items-center justify-center overflow-hidden">
                <VideoTile
                  video={video}
                  index={index}
                  isActive={activeTileIndex === index}
                />
              </div>
            ))
          )}
        </div>

        {isSharedPlaybackMode && (
          <div className="mt-auto flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm">
            <PlayerControls
              isPlaying={isPlaying}
              onPlayPause={handlePlayPause}
              currentTime={currentTime}
              duration={duration}
              onSeek={handleSeek}
              playbackRate={playbackRate}
              onRateChange={handleRateChange}
              onStepBack={() => handleStepFrame(-1)}
              onStepForward={() => handleStepFrame(1)}
              isSyncEnabled={false}
              variant="static"
            />
          </div>
        )}
      </div>
    </div>
  );
}
