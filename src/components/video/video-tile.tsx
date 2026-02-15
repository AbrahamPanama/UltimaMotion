'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useAppContext } from '@/contexts/app-context';
import type { Video } from '@/types';
import PlayerControls from './player-controls';
import { cn } from '@/lib/utils';
import { PlusCircle, X } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';

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
    updateSyncOffset,
    isMuted,
    library,
    setSlot,
    zoomLevels,
    setZoomLevel,
    panPositions,
    setPanPosition
  } = useAppContext();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  
  // Touch handling refs
  const lastTouchDistance = useRef<number | null>(null);
  const lastTouchCenter = useRef<{x: number, y: number} | null>(null);

  const { toast } = useToast();

  const scale = zoomLevels[index] || 1;
  const position = panPositions[index] || { x: 0, y: 0 };

  // Handle ref assignment and cleanup
  useEffect(() => {
    if (videoRefs.current) {
      videoRefs.current[index] = videoRef.current;
    }
    return () => {
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

  // Handle video events
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || !video) return;

    const handleTimeUpdate = () => {
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
      if (videoElement.paused) videoElement.play();
      else videoElement.pause();
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

  const handleRemoveVideo = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSlot(index, null);
    toast({ title: 'Video Removed', description: `Slot ${index + 1} cleared.` });
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

  const renderStepBtn = (seconds: number, size: number) => {
    const isNeg = seconds < 0;
    const label = `${isNeg ? '' : '+'}${seconds}s`;
    return (
      <button
        key={seconds}
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

  // --- Zoom and Pan Logic ---

  const handleZoom = useCallback((delta: number, clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const newScale = Math.min(Math.max(1, scale + delta), 5);

    if (newScale === 1) {
      setZoomLevel(index, 1);
      setPanPosition(index, { x: 0, y: 0 });
      return;
    }

    const mouseX = clientX - rect.left - rect.width / 2;
    const mouseY = clientY - rect.top - rect.height / 2;

    const newX = mouseX - (mouseX - position.x) * (newScale / scale);
    const newY = mouseY - (mouseY - position.y) * (newScale / scale);

    const maxX = (rect.width * (newScale - 1)) / 2;
    const maxY = (rect.height * (newScale - 1)) / 2;

    const clampedX = Math.max(-maxX, Math.min(newX, maxX));
    const clampedY = Math.max(-maxY, Math.min(newY, maxY));

    setZoomLevel(index, newScale);
    setPanPosition(index, { x: clampedX, y: clampedY });
  }, [scale, position, index, setZoomLevel, setPanPosition]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    // Zoom with scroll wheel (no modifier needed, as requested)
    e.preventDefault();
    e.stopPropagation();

    const zoomSensitivity = 0.001;
    const delta = -e.deltaY * zoomSensitivity;
    handleZoom(delta, e.clientX, e.clientY);
  }, [handleZoom]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
      e.stopPropagation();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && scale > 1) {
      e.preventDefault();
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const maxX = (rect.width * (scale - 1)) / 2;
      const maxY = (rect.height * (scale - 1)) / 2;

      setPanPosition(index, {
        x: Math.max(-maxX, Math.min(newX, maxX)),
        y: Math.max(-maxY, Math.min(newY, maxY))
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Touch Handlers for Pinch Zoom and Pan
  const getDistance = (t1: React.Touch, t2: React.Touch) => {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getCenter = (t1: React.Touch, t2: React.Touch) => {
    return {
      x: (t1.clientX + t2.clientX) / 2,
      y: (t1.clientY + t2.clientY) / 2
    };
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = getDistance(e.touches[0], e.touches[1]);
      lastTouchDistance.current = dist;
      lastTouchCenter.current = getCenter(e.touches[0], e.touches[1]);
    } else if (e.touches.length === 1 && scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.touches[0].clientX - position.x, y: e.touches[0].clientY - position.y });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastTouchDistance.current !== null) {
      e.preventDefault(); // Prevent page scroll/zoom
      const dist = getDistance(e.touches[0], e.touches[1]);
      const center = getCenter(e.touches[0], e.touches[1]);
      
      // Calculate delta scale
      // Dist ratio: dist / lastTouchDistance.current
      // But our handleZoom expects a delta to add to current scale.
      // Current implementation is linear additive. Pinch is usually multiplicative.
      // Let's approximate:
      const scaleFactor = dist / lastTouchDistance.current;
      const delta = (scale * scaleFactor) - scale;
      
      // We want to zoom relative to the center of the pinch
      handleZoom(delta, center.x, center.y);
      
      lastTouchDistance.current = dist;
      lastTouchCenter.current = center;
    } else if (e.touches.length === 1 && isDragging && scale > 1) {
       e.preventDefault();
       const newX = e.touches[0].clientX - dragStart.x;
       const newY = e.touches[0].clientY - dragStart.y;
       
       const rect = containerRef.current?.getBoundingClientRect();
       if (!rect) return;

       const maxX = (rect.width * (scale - 1)) / 2;
       const maxY = (rect.height * (scale - 1)) / 2;

       setPanPosition(index, {
         x: Math.max(-maxX, Math.min(newX, maxX)),
         y: Math.max(-maxY, Math.min(newY, maxY))
       });
    }
  };

  const handleTouchEnd = () => {
    lastTouchDistance.current = null;
    lastTouchCenter.current = null;
    setIsDragging(false);
  };

  if (!video) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <div
            className={cn(
              "bg-muted/50 border-2 border-dashed rounded-lg flex items-center justify-center cursor-pointer hover:border-primary transition-colors max-h-full relative group",
              isPortraitMode ? 'aspect-[9/16]' : 'aspect-video'
            )}
          >
            <div className="text-center text-muted-foreground group-hover:text-primary transition-colors">
              <PlusCircle className="mx-auto h-12 w-12 mb-2 opacity-50 group-hover:opacity-100 transition-opacity" />
              <p className="font-medium text-sm">Add Video</p>
            </div>
          </div>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-56">
          {library.length > 0 ? (
            library.map(libVideo => (
              <DropdownMenuItem key={libVideo.id} onClick={() => handleSelectVideo(libVideo)} className="cursor-pointer">
                <span className="truncate">{libVideo.name}</span>
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
      ref={containerRef}
      className={cn(
        'relative bg-black rounded-lg overflow-hidden flex flex-col transition-all duration-300 group',
        isPortraitMode ? 'h-full aspect-[9/16]' : 'w-full h-full',
        isActive ? 'ring-2 ring-primary shadow-lg z-10' : 'ring-1 ring-white/10 hover:ring-white/30'
      )}
      onClick={() => setActiveTileIndex(index)}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 z-30 h-8 w-8 bg-black/50 hover:bg-destructive/90 text-white opacity-0 group-hover:opacity-100 transition-opacity rounded-full backdrop-blur-sm"
        onClick={handleRemoveVideo}
        title="Remove video from slot"
      >
        <X className="h-4 w-4" />
      </Button>

      <div className="flex-1 min-h-0 overflow-hidden relative">
        <video
          ref={videoRef}
          src={video.url}
          className={cn(
            'w-full h-full touch-none',
            isPortraitMode ? 'object-cover' : 'object-contain',
             isDragging ? 'cursor-grabbing' : (scale > 1 ? 'cursor-grab' : 'cursor-default')
          )}
          style={{
             transform: `scale(${scale}) translate(${position.x / scale}px, ${position.y / scale}px)`,
             transition: isDragging ? 'none' : 'transform 0.1s ease-out'
          }}
          playsInline
        />
      </div>
      
      {/* Controls Overlay */}
      <div className="z-20 bg-gradient-to-t from-black/90 via-black/50 to-transparent pb-1 pt-4 px-2 flex flex-col gap-2">
        {/* Step buttons bar - Visible now */}
        <div 
          className="flex items-center justify-center gap-2 py-1" 
          onClick={e => e.stopPropagation()}
        >
          {renderStepBtn(-0.5, 28)}
          {renderStepBtn(-0.1, 28)}
          <div className="w-px h-4 bg-white/20 mx-1" />
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
          isSyncEnabled={isSyncEnabled}
          variant="static"
        />
      </div>
    </div>
  );
}
