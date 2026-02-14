'use client';
import { useAppContext } from '@/contexts/app-context';
import VideoTile from './video-tile';
import { cn } from '@/lib/utils';
import { useEffect, useState, useRef, useCallback } from 'react';
import PlayerControls from './player-controls';

function SyncControls() {
    const { videoRefs, slots, isSyncEnabled, isLoopEnabled, syncOffsets } = useAppContext();
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1.0);

    const rafRef = useRef<number | null>(null);
    const startTimeRef = useRef<number | null>(null);
    const startOffsetRef = useRef<number>(0);
    const lastUIUpdateRef = useRef<number>(0);

    // Store volatile values in refs so tick never needs to be recreated
    const playbackRateRef = useRef(playbackRate);
    const slotsRef = useRef(slots);
    const syncOffsetsRef = useRef(syncOffsets);
    const isLoopEnabledRef = useRef(isLoopEnabled);
    playbackRateRef.current = playbackRate;
    slotsRef.current = slots;
    syncOffsetsRef.current = syncOffsets;
    isLoopEnabledRef.current = isLoopEnabled;

    // Stable helper — no deps that change
    const getActiveVideos = useCallback(() => {
        return videoRefs.current
            .map((video, index) => ({ video, index }))
            .filter((item): item is { video: HTMLVideoElement; index: number } =>
                item.video !== null && item.video.isConnected
            );
    }, [videoRefs]);

    const getLoopDuration = useCallback(() => {
        const activeVideos = getActiveVideos();
        if (activeVideos.length === 0) return 0;
        const lengths = activeVideos.map(({ index }) => {
            const slot = slotsRef.current[index];
            const videoEl = videoRefs.current[index];
            if (!slot || !videoEl) return 0;
            const start = slot.trimStart || 0;
            const end = slot.trimEnd || videoEl.duration || 0;
            return Math.max(0, end - start);
        }).filter(l => l > 0);
        if (lengths.length === 0) return 0;
        return Math.min(...lengths);
    }, [getActiveVideos, videoRefs]);

    // Stable tick — reads everything from refs, never recreated
    const tick = useCallback(() => {
        const activeVideos = getActiveVideos();
        if (activeVideos.length === 0) {
            rafRef.current = null;
            return;
        }

        const loopDuration = getLoopDuration();
        if (loopDuration <= 0) {
            rafRef.current = requestAnimationFrame(tick);
            return;
        }

        const now = performance.now();
        const elapsedMs = now - (startTimeRef.current || now);
        const elapsedSec = (elapsedMs / 1000) * playbackRateRef.current;
        let t_loop = startOffsetRef.current + elapsedSec;

        // Handle looping
        if (isLoopEnabledRef.current && t_loop >= loopDuration) {
            t_loop = t_loop % loopDuration;
            startTimeRef.current = now;
            startOffsetRef.current = t_loop;
        } else if (!isLoopEnabledRef.current && t_loop >= loopDuration) {
            t_loop = loopDuration;
            activeVideos.forEach(({ video }) => video.pause());
            setIsPlaying(false);
            rafRef.current = null;
            return;
        }

        // Apply position to each video with its sync offset
        const offsets = syncOffsetsRef.current;
        const currentSlots = slotsRef.current;
        activeVideos.forEach(({ video, index }) => {
            const slot = currentSlots[index];
            if (!slot) return;
            const trimStart = slot.trimStart || 0;
            const target = trimStart + (offsets[index] || 0) + t_loop;
            if (Math.abs(video.currentTime - target) > 0.05) {
                video.currentTime = target;
            }
        });

        // Throttle React state updates to ~4 times/second
        if (now - lastUIUpdateRef.current > 250) {
            setCurrentTime(t_loop);
            setDuration(loopDuration);
            lastUIUpdateRef.current = now;
        }

        rafRef.current = requestAnimationFrame(tick);
    }, [getActiveVideos, getLoopDuration]);

    // Start/stop the rAF loop — tick is stable so this rarely re-runs
    useEffect(() => {
        if (isPlaying && isSyncEnabled) {
            if (startTimeRef.current === null) {
                startTimeRef.current = performance.now();
            }
            rafRef.current = requestAnimationFrame(tick);
        }
        return () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [isPlaying, isSyncEnabled, tick]);

    const handlePlayPause = () => {
        const activeVideos = getActiveVideos();
        const shouldPlay = !isPlaying;

        if (shouldPlay) {
            startTimeRef.current = performance.now();

            activeVideos.forEach(({ video }) => {
                video.play().catch(e => console.error("Sync play failed:", e));
            });
        } else {
            if (startTimeRef.current !== null) {
                const elapsedMs = performance.now() - startTimeRef.current;
                const elapsedSec = (elapsedMs / 1000) * playbackRateRef.current;
                const loopDuration = getLoopDuration();
                if (loopDuration > 0 && isLoopEnabledRef.current) {
                    startOffsetRef.current = (startOffsetRef.current + elapsedSec) % loopDuration;
                } else {
                    startOffsetRef.current = startOffsetRef.current + elapsedSec;
                }
            }
            startTimeRef.current = null;

            activeVideos.forEach(({ video }) => video.pause());
        }

        setIsPlaying(shouldPlay);
    };

    const handleSeek = (time: number) => {
        startOffsetRef.current = time;
        startTimeRef.current = performance.now();

        const activeVideos = getActiveVideos();
        const offsets = syncOffsetsRef.current;
        const currentSlots = slotsRef.current;
        activeVideos.forEach(({ video, index }) => {
            const slot = currentSlots[index];
            if (!slot) return;
            const trimStart = slot.trimStart || 0;
            video.currentTime = trimStart + (offsets[index] || 0) + time;
        });
        setCurrentTime(time);
    };

    const handleRateChange = (rate: number) => {
        if (startTimeRef.current !== null && isPlaying) {
            const elapsedMs = performance.now() - startTimeRef.current;
            const elapsedSec = (elapsedMs / 1000) * playbackRateRef.current;
            const loopDuration = getLoopDuration();
            if (loopDuration > 0 && isLoopEnabledRef.current) {
                startOffsetRef.current = (startOffsetRef.current + elapsedSec) % loopDuration;
            } else {
                startOffsetRef.current = startOffsetRef.current + elapsedSec;
            }
            startTimeRef.current = performance.now();
        }

        const activeVideos = getActiveVideos();
        activeVideos.forEach(({ video }) => {
            video.playbackRate = rate;
        });
        setPlaybackRate(rate);
    };

    return (
        <div className="bg-card p-2 border rounded-lg shadow-sm mt-auto">
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
    );
}


export default function VideoGrid() {
    const { layout, slots, activeTileIndex, isSyncEnabled } = useAppContext();

    const gridClasses = {
        1: 'grid-cols-1',
        2: 'grid-cols-1 md:grid-cols-2',
        4: 'grid-cols-2',
    };

    return (
        <div className="flex-1 flex flex-col gap-4 overflow-hidden h-full">
            <div className={cn('grid gap-4 flex-1 min-h-0 auto-rows-[1fr]', gridClasses[layout])}>
                {slots.slice(0, layout).map((video, index) => (
                    <div key={index} className="min-h-0 min-w-0 overflow-hidden flex items-center justify-center">
                        <VideoTile
                            video={video}
                            index={index}
                            isActive={activeTileIndex === index}
                        />
                    </div>
                ))}
            </div>
            {isSyncEnabled && <SyncControls />}
        </div>
    );
}
