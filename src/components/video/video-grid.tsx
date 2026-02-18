'use client';
import { useAppContext } from '@/contexts/app-context';
import VideoTile from './video-tile';
import { cn } from '@/lib/utils';
import { useEffect, useState, useRef, useCallback } from 'react';
import PlayerControls from './player-controls';
import type { Video } from '@/types';
import { useIsMobile } from '@/hooks/use-mobile';

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
        setPlaybackRate
    } = useAppContext();
    const isMobile = useIsMobile();

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    // Use refs for animation frame loop to avoid stale closures
    const rafRef = useRef<number | null>(null);

    const getActiveVideos = useCallback(() => {
        return videoRefs.current
            .map((video, index) => ({ video, index, slot: slots[index] }))
            .filter((item): item is { video: HTMLVideoElement; index: number; slot: Video } =>
                item.video !== null && item.slot !== null
            );
    }, [videoRefs, slots]);

    const getTrimBounds = useCallback((slot: Video, video: HTMLVideoElement) => {
        const start = slot.trimStart ?? 0;
        const trimEnd = slot.trimEnd ?? video.duration;
        const end = Number.isFinite(trimEnd) ? trimEnd : start;
        return { start, end: Math.max(start, end) };
    }, []);

    const clampToTrim = useCallback((time: number, slot: Video, video: HTMLVideoElement) => {
        const { start, end } = getTrimBounds(slot, video);
        return Math.max(start, Math.min(time, end));
    }, [getTrimBounds]);

    // Calculate the effective duration of the sync session (shortest loop or max length)
    const getSyncDuration = useCallback(() => {
        const active = getActiveVideos();
        if (active.length === 0) return 0;
        
        // Find the minimum duration among active clips to loop seamlessly?
        // Or maximum to play all? Let's use maximum for now, but loop based on shortest?
        // Usually sync play means play until the shortest one ends, then loop.
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


    // Sync Loop
    const tick = useCallback(() => {
        if (!isPlaying) return;

        const active = getActiveVideos();
        if (active.length === 0) {
            setIsPlaying(false);
            return;
        }

        // Just update UI current time from the first active video for display
        // In a real sync engine we'd drive videos from a master clock. 
        // Here we just let them play and periodically re-sync if drifted?
        // For simplicity, let's just read the time of the first video.
        
        const master = active[0];
        if (master) {
             const { start } = getTrimBounds(master.slot, master.video);
             const offset = syncOffsets[master.index] || 0;
             const masterStart = clampToTrim(start + offset, master.slot, master.video);
             const relativeTime = master.video.currentTime - masterStart;
             setCurrentTime(Math.max(0, relativeTime));
             
             // Check for loop
             const syncDur = getSyncDuration();
             if (isLoopEnabled && syncDur > 0 && relativeTime >= syncDur) {
                 // Reset all
                 active.forEach(({ video, index, slot }) => {
                     const { start } = getTrimBounds(slot, video);
                     const tileOffset = syncOffsets[index] || 0;
                     video.currentTime = clampToTrim(start + tileOffset, slot, video);
                     video.play().catch(() => {});
                 });
             }
        }

        rafRef.current = requestAnimationFrame(tick);
    }, [clampToTrim, getActiveVideos, getSyncDuration, getTrimBounds, isLoopEnabled, isPlaying, syncOffsets]);

    useEffect(() => {
        if (isSyncEnabled && isPlaying) {
            rafRef.current = requestAnimationFrame(tick);
        } else {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        }
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [isSyncEnabled, isPlaying, tick]);

    // Update duration when videos change
    useEffect(() => {
        if (isSyncEnabled) {
            setDuration(getSyncDuration());
        }
    }, [isSyncEnabled, getSyncDuration, slots]);


    const handlePlayPause = () => {
        const active = getActiveVideos();
        if (active.length === 0) return;

        if (isPlaying) {
            active.forEach(({ video }) => video.pause());
            setIsPlaying(false);
        } else {
            active.forEach(({ video }) => video.play().catch(e => console.error("Play error", e)));
            setIsPlaying(true);
        }
    };

    const handleSeek = (time: number) => {
        const active = getActiveVideos();
        const syncDuration = getSyncDuration();
        const clampedTime = syncDuration > 0 ? Math.max(0, Math.min(time, syncDuration)) : Math.max(0, time);

        active.forEach(({ video, index, slot }) => {
            const { start } = getTrimBounds(slot, video);
            const offset = syncOffsets[index] || 0;
            video.currentTime = clampToTrim(start + offset + clampedTime, slot, video);
        });
        setCurrentTime(clampedTime);
    };

    const handleRateChange = (rate: number) => {
        videoRefs.current.forEach((video, index) => {
            if (!video || !slots[index]) return;
            video.playbackRate = rate;
        });
        setPlaybackRate(rate);
    };

    const effectiveLayout = isMobile && layout === 4 ? 2 : layout;

    const gridClasses = {
        1: 'grid-cols-1',
        2: isMobile ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2',
        4: isMobile ? 'grid-cols-1' : 'grid-cols-2',
    };

    return (
        <div className="flex-1 flex flex-col gap-4 overflow-hidden h-full">
            <div className={cn('grid gap-4 flex-1 min-h-0 auto-rows-[1fr]', gridClasses[effectiveLayout])}>
                {slots.slice(0, effectiveLayout).map((video, index) => (
                    <div key={index} className="min-h-0 min-w-0 overflow-hidden flex items-center justify-center">
                        <VideoTile
                            video={video}
                            index={index}
                            isActive={activeTileIndex === index}
                        />
                    </div>
                ))}
            </div>

            {/* Global Sync Controls Bar */}
            {isSyncEnabled && (
                 <div className="bg-card p-3 border rounded-lg shadow-sm mt-auto flex flex-col gap-2">
                    <PlayerControls
                        isPlaying={isPlaying}
                        onPlayPause={handlePlayPause}
                        currentTime={currentTime}
                        duration={duration}
                        onSeek={handleSeek}
                        playbackRate={playbackRate}
                        onRateChange={handleRateChange}
                        isSyncEnabled={false} // Pass false so it renders normal controls, not the "Sync Active" badge
                        variant="static"
                    />
                </div>
            )}
        </div>
    );
}
