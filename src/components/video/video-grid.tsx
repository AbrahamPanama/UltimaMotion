'use client';
import { useAppContext } from '@/contexts/app-context';
import VideoTile from './video-tile';
import { cn } from '@/lib/utils';
import { useEffect, useState, useRef, useCallback } from 'react';
import PlayerControls from './player-controls';
import { Button } from '@/components/ui/button';

export default function VideoGrid() {
    const { 
        layout, 
        slots, 
        activeTileIndex, 
        isSyncEnabled, 
        videoRefs,
        isLoopEnabled,
        syncOffsets,
        updateSyncOffset 
    } = useAppContext();

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackRate, setPlaybackRate] = useState(1.0);
    
    // Use refs for animation frame loop to avoid stale closures
    const rafRef = useRef<number | null>(null);
    const lastTimeRef = useRef<number>(0);

    const getActiveVideos = useCallback(() => {
        return videoRefs.current
            .map((video, index) => ({ video, index, slot: slots[index] }))
            .filter((item): item is { video: HTMLVideoElement; index: number; slot: any } => 
                item.video !== null && item.slot !== null
            );
    }, [videoRefs, slots]);

    // Calculate the effective duration of the sync session (shortest loop or max length)
    const getSyncDuration = useCallback(() => {
        const active = getActiveVideos();
        if (active.length === 0) return 0;
        
        // Find the minimum duration among active clips to loop seamlessly?
        // Or maximum to play all? Let's use maximum for now, but loop based on shortest?
        // Usually sync play means play until the shortest one ends, then loop.
        const durations = active.map(({ video, slot }) => {
            const start = slot.trimStart || 0;
            const end = slot.trimEnd || video.duration;
            return Math.max(0, end - start);
        });
        
        return Math.max(...durations) || 0; 
    }, [getActiveVideos]);


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
             const start = master.slot.trimStart || 0;
             const relativeTime = master.video.currentTime - start - (syncOffsets[master.index] || 0);
             setCurrentTime(relativeTime);
             
             // Check for loop
             const syncDur = getSyncDuration();
             if (isLoopEnabled && relativeTime >= syncDur) {
                 // Reset all
                 active.forEach(({ video, index, slot }) => {
                     const s = slot.trimStart || 0;
                     const offset = syncOffsets[index] || 0;
                     video.currentTime = s + offset;
                     video.play().catch(() => {});
                 });
             }
        }

        rafRef.current = requestAnimationFrame(tick);
    }, [isPlaying, getActiveVideos, isLoopEnabled, getSyncDuration, syncOffsets]);

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
        active.forEach(({ video, index, slot }) => {
            const start = slot.trimStart || 0;
            const offset = syncOffsets[index] || 0;
            video.currentTime = start + offset + time;
        });
        setCurrentTime(time);
    };

    const handleRateChange = (rate: number) => {
        const active = getActiveVideos();
        active.forEach(({ video }) => {
            video.playbackRate = rate;
        });
        setPlaybackRate(rate);
    };

    // Step function for sync mode
    const handleStep = (seconds: number) => {
        const active = getActiveVideos();
        
        // If playing, pause first
        if (isPlaying) {
            handlePlayPause();
        }

        active.forEach(({ video, index, slot }) => {
             // Just advance everything by 'seconds' relative to current state
             // We don't change offsets here, we just move the playhead
             video.currentTime = video.currentTime + seconds;
        });
        
        // Update UI time from master
        if (active.length > 0) {
            const master = active[0];
            const start = master.slot.trimStart || 0;
            setCurrentTime(master.video.currentTime - start - (syncOffsets[master.index] || 0));
        }
    };

    const renderStepBtn = (seconds: number, size: number, labelOverride?: string) => {
        const isNeg = seconds < 0;
        const label = labelOverride || `${isNeg ? '' : '+'}${seconds}s`;
        return (
          <button
            key={label}
            onClick={(e) => { e.stopPropagation(); handleStep(seconds); }}
            className="flex-shrink-0 text-white/90 hover:text-white hover:scale-110 active:scale-90 transition-all focus:outline-none focus:ring-1 focus:ring-white/50 rounded-full"
            title={label}
            aria-label={`Step video ${label}`}
          >
            <div className="relative flex items-center justify-center bg-black/60 rounded-full px-2 py-1 backdrop-blur-sm border border-white/20 hover:bg-black/80 transition-colors">
                <span className="font-mono font-bold text-xs" style={{ fontSize: size/2.2 }}>
                    {label}
                </span>
            </div>
          </button>
        );
      };

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

            {/* Global Sync Controls Bar */}
            {isSyncEnabled && (
                 <div className="bg-card p-3 border rounded-lg shadow-sm mt-auto flex flex-col gap-2">
                    
                    <div className="flex items-center justify-center gap-2 mb-2">
                        {renderStepBtn(-0.5, 28)}
                        {renderStepBtn(-0.1, 28)}
                        {renderStepBtn(-1/30, 28, '-1f')}
                        <div className="w-px h-4 bg-border/50 mx-2" />
                        {renderStepBtn(1/30, 28, '+1f')}
                        {renderStepBtn(0.1, 28)}
                        {renderStepBtn(0.5, 28)}
                    </div>

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
