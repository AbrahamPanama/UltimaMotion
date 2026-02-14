'use client';
import { useEffect, useState, useRef } from 'react';
import { useAppContext } from '@/contexts/app-context';
import type { Video } from '@/types';
import PlayerControls from './player-controls';
import { cn } from '@/lib/utils';
import { PlusCircle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToast } from '@/hooks/use-toast';

interface VideoTileProps {
  video: Video | null;
  index: number;
  isActive: boolean;
}

export default function VideoTile({ video, index, isActive }: VideoTileProps) {
  const {
    setActiveTileIndex,
    videoRefs,
    isSyncEnabled,
    isPortraitMode,
    isLoopEnabled,
    syncOffsets,
    updateSyncOffset,
    isMuted,
    library,
    setSlot
  } = useAppContext();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const { toast } = useToast();

  // Handle ref assignment and cleanup
  useEffect(() => {
    if (videoRefs.current) {
      videoRefs.current[index] = videoRef.current;
    }
    return () => {
      // Clean up ref on unmount to prevent stale references in SyncControls
      if (videoRefs.current) {
        videoRefs.current[index] = null;
      }
    };
  }, [index, videoRefs, video]);

  // Mute/unmute based on active state and global mute toggle
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;
    videoElement.muted = isMuted || !isActive;
  }, [isActive, isMuted]);

  // Handle all video event listeners, state updates, and looping
  // When sync is ON, looping is handled by the master clock in SyncControls
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || !video) return;

    const handleTimeUpdate = () => {
      // Only handle local looping when sync is OFF
      if (!isSyncEnabled) {
        const now = videoElement.currentTime;
        if (isLoopEnabled && video.trimEnd && now >= video.trimEnd) {
          const wasPlaying = !videoElement.paused;
          const overshoot = now - video.trimEnd;
          videoElement.currentTime = (video.trimStart || 0) + overshoot;
          if (wasPlaying) {
            videoElement.play().catch(e => console.warn("Loop play failed", e));
          }
        }
      }
      setCurrentTime(videoElement.currentTime);
    };

    // Loop when video reaches natural end (only when sync is OFF)
    const handleEnded = () => {
      if (!isSyncEnabled && isLoopEnabled) {
        videoElement.currentTime = video.trimStart || 0;
        videoElement.play().catch(e => console.warn("Loop play failed", e));
      }
    };

    const handleDurationChange = () => setDuration(videoElement.duration);
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    videoElement.addEventListener('timeupdate', handleTimeUpdate);
    videoElement.addEventListener('ended', handleEnded);
    videoElement.addEventListener('durationchange', handleDurationChange);
    videoElement.addEventListener('play', handlePlay);
    videoElement.addEventListener('pause', handlePause);

    // Initialize state when video changes
    videoElement.currentTime = video.trimStart || 0;
    setCurrentTime(videoElement.currentTime);
    if (videoElement.duration) setDuration(videoElement.duration);
    setIsPlaying(!videoElement.paused);

    return () => {
      videoElement.removeEventListener('timeupdate', handleTimeUpdate);
      videoElement.removeEventListener('ended', handleEnded);
      videoElement.removeEventListener('durationchange', handleDurationChange);
      videoElement.removeEventListener('play', handlePlay);
      videoElement.removeEventListener('pause', handlePause);
    };
  }, [video, isLoopEnabled, isSyncEnabled]);

  const handlePlayPause = () => {
    const videoElement = videoRef.current;
    if (videoElement) {
      if (videoElement.paused) {
        videoElement.play();
      } else {
        videoElement.pause();
      }
    }
  };

  const handleSeek = (time: number) => {
    const videoElement = videoRef.current;
    if (videoElement) {
      const start = video?.trimStart || 0;
      const end = video?.trimEnd || videoElement.duration;
      videoElement.currentTime = Math.max(start, Math.min(time, end));
      setCurrentTime(videoElement.currentTime);
    }
  };

  const handleRateChange = (rate: number) => {
    const videoElement = videoRef.current;
    if (videoElement) {
      videoElement.playbackRate = rate;
      setPlaybackRate(rate);
    }
  };

  const handleSelectVideo = (selectedVideo: Video) => {
    setSlot(index, selectedVideo);
    toast({ title: 'Video Added', description: `"${selectedVideo.name}" added to slot ${index + 1}.` });
  };

  const handleStep = (seconds: number) => {
    const videoElement = videoRef.current;
    if (videoElement) {
      if (isSyncEnabled) {
        updateSyncOffset(index, seconds);
        videoElement.currentTime = videoElement.currentTime + seconds;
      } else {
        const start = video?.trimStart || 0;
        const end = video?.trimEnd || videoElement.duration;
        videoElement.currentTime = Math.max(start, Math.min(videoElement.currentTime + seconds, end));
      }
      setCurrentTime(videoElement.currentTime);
    }
  };

  // Render helper (returns JSX, NOT a component — avoids unmount/remount on re-render)
  const renderStepBtn = (seconds: number, size: number) => {
    const isNeg = seconds < 0;
    return (
      <button
        key={seconds}
        onClick={(e) => { e.stopPropagation(); handleStep(seconds); }}
        className="flex-shrink-0 text-primary hover:text-primary/80 active:scale-90 transition-all"
        title={`${isNeg ? '' : '+'}${seconds}s`}
      >
        <svg width={size} height={size} viewBox="0 0 40 40" fill="currentColor">
          <circle cx="20" cy="20" r="19" />
          <rect x="10" y="17.5" width="20" height="5" rx="1" fill="white" />
          {!isNeg && <rect x="17.5" y="10" width="5" height="20" rx="1" fill="white" />}
        </svg>
      </button>
    );
  };


  if (!video) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div
            suppressHydrationWarning
            className={cn(
              "bg-muted/50 border-2 border-dashed rounded-lg flex items-center justify-center cursor-pointer hover:border-primary transition-colors max-h-full",
              isPortraitMode ? 'aspect-[9/16]' : 'aspect-video'
            )}
          >
            <div className="text-center text-muted-foreground">
              <PlusCircle className="mx-auto h-12 w-12" />
              <p className="mt-2 font-medium">Add Video</p>
            </div>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {library.length > 0 ? (
            library.map(libVideo => (
              <DropdownMenuItem key={libVideo.id} onClick={() => handleSelectVideo(libVideo)}>
                {libVideo.name}
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem disabled>Library is empty</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div
      className={cn(
        'relative bg-black rounded-lg overflow-hidden flex flex-col transition-all duration-300',
        isPortraitMode ? 'h-full aspect-[9/16]' : 'w-full h-full',
        isActive ? 'ring-4 ring-primary shadow-2xl' : 'ring-2 ring-transparent'
      )}
      onClick={() => setActiveTileIndex(index)}
    >
      <video
        ref={videoRef}
        src={video.url}
        className={cn(
          'w-full flex-1 min-h-0',
          isPortraitMode ? 'object-cover' : 'object-contain'
        )}
        playsInline
      />
      {/* Step buttons bar */}
      <div className="flex items-center justify-center gap-1.5 py-1.5 px-2 bg-black/70" onClick={e => e.stopPropagation()}>
        {renderStepBtn(-0.5, 32)}
        {renderStepBtn(-0.25, 26)}
        {renderStepBtn(-0.15, 20)}
        <div className="w-6" />
        {renderStepBtn(0.15, 20)}
        {renderStepBtn(0.25, 26)}
        {renderStepBtn(0.5, 32)}
      </div>
      <PlayerControls
        isPlaying={isPlaying}
        onPlayPause={handlePlayPause}
        currentTime={currentTime}
        duration={duration}
        onSeek={handleSeek}
        playbackRate={playbackRate}
        onRateChange={handleRateChange}
        isSyncEnabled={isSyncEnabled}
        variant="static"
      />
    </div>
  );
}
