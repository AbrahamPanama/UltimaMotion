'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import { useAppContext } from '@/contexts/app-context';
import VideoTile from './video-tile';
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
const SEEK_TIMEOUT_MS = 300;

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
    slots,
    activeTileIndex,
    isSyncEnabled,
    videoRefs,
    isLoopEnabled,
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
  const syncBusyRef = useRef(false);
  const pendingSyncRef = useRef<{ relativeTime: number; resume: boolean } | null>(null);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const getActiveVideos = useCallback((): ActiveVideoEntry[] => {
    return videoRefs.current
      .map((video, index) => ({ video, index, slot: slots[index] }))
      .filter((item): item is ActiveVideoEntry => item.video !== null && item.slot !== null);
  }, [videoRefs, slots]);

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
    async (relativeTime: number, options?: { resume?: boolean }) => {
      const requestedResume = options?.resume ?? isPlayingRef.current;
      pendingSyncRef.current = { relativeTime, resume: requestedResume };

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

          active.forEach(({ video }) => {
            video.playbackRate = playbackRate;
          });

          setCurrentTime(clampedRelative);

          if (next.resume) {
            await Promise.all(
              active.map(({ video }) =>
                video.play().catch(() => undefined)
              )
            );
          }

          setIsPlaying(next.resume);
        }
      } finally {
        syncBusyRef.current = false;
      }
    },
    [clampToTrim, getActiveVideos, getSyncDuration, getTrimBounds, playbackRate, syncOffsets]
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
    if (isSyncEnabled && isPlaying) {
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
  }, [isSyncEnabled, isPlaying, tick]);

  useEffect(() => {
    if (!isSyncEnabled) return;
    setDuration(getSyncDuration());
  }, [isSyncEnabled, getSyncDuration, slots]);

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
    void syncToRelativeTime(clampedTime, { resume: isPlayingRef.current });
  };

  const handleRateChange = (rate: number) => {
    const active = getActiveVideos();
    if (active.length === 0) {
      setPlaybackRate(rate);
      return;
    }

    const masterRelative = getMasterRelativeTime(active);
    void syncToRelativeTime(masterRelative, { resume: isPlayingRef.current }).then(() => {
      const latest = getActiveVideos();
      latest.forEach(({ video }) => {
        video.playbackRate = rate;
      });
      setPlaybackRate(rate);
    });
  };

  const effectiveLayout = isMobile && layout === 4 ? 2 : layout;

  const gridClasses = {
    1: 'grid-cols-1',
    2: isMobile ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2',
    4: isMobile ? 'grid-cols-1' : 'grid-cols-2',
  };

  return (
    <div className="flex h-full flex-1 gap-4 overflow-hidden">
      <div className="flex h-full flex-1 flex-col gap-4 overflow-hidden">
        <div className={cn('grid flex-1 min-h-0 auto-rows-[1fr] gap-4', gridClasses[effectiveLayout])}>
          {slots.slice(0, effectiveLayout).map((video, index) => (
            <div key={index} className="flex min-h-0 min-w-0 items-center justify-center overflow-hidden">
              <VideoTile
                video={video}
                index={index}
                isActive={activeTileIndex === index}
              />
            </div>
          ))}
        </div>

        {isSyncEnabled && (
          <div className="mt-auto flex flex-col gap-2 rounded-lg border bg-card p-3 shadow-sm">
            <PlayerControls
              isPlaying={isPlaying}
              onPlayPause={handlePlayPause}
              currentTime={currentTime}
              duration={duration}
              onSeek={handleSeek}
              playbackRate={playbackRate}
              onRateChange={handleRateChange}
              isSyncEnabled={false}
              variant="static"
            />
          </div>
        )}
      </div>
    </div>
  );
}
