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
import DrawingCanvas from './drawing-canvas';
import PoseOverlay from './pose-overlay';

interface VideoTileProps {
  video: Video | null;
  index: number;
  isActive: boolean;
}

const DEFAULT_POSITION = { x: 0, y: 0 };

export default function VideoTile({ video, index, isActive }: VideoTileProps) {
  const {
    setActiveTileIndex,
    videoRefs,
    isSyncEnabled,
    isPortraitMode,
    isLoopEnabled,
    updateSyncOffset,
    syncOffsets,
    isMuted,
    playbackRate,
    setPlaybackRate,
    library,
    slots,
    setSlot,
    zoomLevels,
    setZoomLevel,
    panPositions,
    setPanPosition,
    // Drawing
    isDrawingEnabled,
    drawingTool,
    drawingColor,
    drawings,
    setDrawingsForVideo,
    // Pose overlay
    isPoseEnabled,
    poseAnalyzeScope,
    poseModelVariant,
    poseMinVisibility,
    poseTargetFps,
    poseMinPoseDetectionConfidence,
    poseMinPosePresenceConfidence,
    poseMinTrackingConfidence
  } = useAppContext();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Touch handling refs
  const lastTouchDistance = useRef<number | null>(null);
  const lastTouchCenter = useRef<{ x: number, y: number } | null>(null);
  const wasPlayingBeforeHiddenRef = useRef(false);

  const { toast } = useToast();

  const scale = zoomLevels[index] ?? 1;
  const position = panPositions[index] ?? DEFAULT_POSITION;

  const currentDrawings = video ? (drawings[video.id] || []) : [];
  const shouldAnalyzePose = Boolean(video) && isPoseEnabled && (poseAnalyzeScope === 'all-visible' || isActive);

  // Handle ref assignment and cleanup
  useEffect(() => {
    const refs = videoRefs.current;
    if (refs) {
      refs[index] = videoRef.current;
    }
    setVideoElement(videoRef.current);
    return () => {
      if (refs) {
        refs[index] = null;
      }
      setVideoElement(null);
    };
  }, [index, videoRefs, video]);

  // Recover video frame after tab/app focus changes.
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || !video) return;

    const getTrimBounds = () => {
      const start = video.trimStart ?? 0;
      const rawEnd = video.trimEnd ?? videoElement.duration;
      const end = Number.isFinite(rawEnd) ? Math.max(start, rawEnd) : start;
      return { start, end };
    };

    const recoverFrame = () => {
      const element = videoRef.current;
      if (!element || document.hidden) return;

      const applyRecovery = () => {
        const { start, end } = getTrimBounds();
        const current = element.currentTime;
        const nextTime = Number.isFinite(current)
          ? Math.max(start, Math.min(current, end))
          : start;

        element.currentTime = nextTime;
        element.playbackRate = playbackRate;

        if (wasPlayingBeforeHiddenRef.current) {
          element.play().catch(() => {});
        } else {
          element.pause();
        }
      };

      if (element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        applyRecovery();
      } else {
        const onReady = () => {
          element.removeEventListener('loadeddata', onReady);
          applyRecovery();
        };
        element.addEventListener('loadeddata', onReady, { once: true });
        element.load();
      }
    };

    const handleVisibilityChange = () => {
      const element = videoRef.current;
      if (!element) return;
      if (document.hidden) {
        wasPlayingBeforeHiddenRef.current = !element.paused;
        return;
      }
      recoverFrame();
    };

    const handleWindowFocus = () => recoverFrame();

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pageshow', handleWindowFocus);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pageshow', handleWindowFocus);
    };
  }, [playbackRate, video]);

  // Ensure newly mounted/changed videos inherit the current global playback rate.
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || !video) return;
    videoElement.playbackRate = playbackRate;
  }, [video, playbackRate]);

  // Mute/unmute based on active state and global mute toggle
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement) return;
    videoElement.muted = isMuted || !isActive;
  }, [isActive, isMuted]);

  // Handle video events — all times normalised to trim-relative (0 → trimLength)
  useEffect(() => {
    const videoElement = videoRef.current;
    if (!videoElement || !video) return;

    const trimStart = video.trimStart || 0;

    const handleTimeUpdate = () => {
      const now = videoElement.currentTime;
      if (!isSyncEnabled) {
        const trimEnd = video.trimEnd || videoElement.duration;
        if (isLoopEnabled && now >= trimEnd) {
          const overshoot = now - trimEnd;
          videoElement.currentTime = trimStart + overshoot;
          if (!videoElement.paused) {
            videoElement.play().catch(e => console.warn("Loop play failed", e));
          }
        }
      }
      // Report trim-relative time to the slider
      setCurrentTime(Math.max(0, videoElement.currentTime - trimStart));
    };

    const handleEnded = () => {
      if (!isSyncEnabled && isLoopEnabled) {
        videoElement.currentTime = trimStart;
        videoElement.play().catch(e => console.warn("Loop play failed", e));
      }
    };

    const handleDurationChange = () => {
      const trimEnd = video.trimEnd || videoElement.duration;
      setDuration(Math.max(0, trimEnd - trimStart));
    };
    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);

    videoElement.addEventListener('timeupdate', handleTimeUpdate);
    videoElement.addEventListener('ended', handleEnded);
    videoElement.addEventListener('durationchange', handleDurationChange);
    videoElement.addEventListener('play', handlePlay);
    videoElement.addEventListener('pause', handlePause);

    // Initialize at trim start
    videoElement.currentTime = trimStart;
    setCurrentTime(0);
    if (videoElement.duration) {
      const trimEnd = video.trimEnd || videoElement.duration;
      setDuration(Math.max(0, trimEnd - trimStart));
    }
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
      if (videoElement.paused) videoElement.play().catch(() => {});
      else videoElement.pause();
    }
  };

  // time is trim-relative (0 = trimStart), convert back to raw
  const handleSeek = (time: number) => {
    const videoElement = videoRef.current;
    if (videoElement) {
      const start = video?.trimStart || 0;
      const end = video?.trimEnd || videoElement.duration;
      const trimLength = end - start;
      const clampedRelative = Math.max(0, Math.min(time, trimLength));
      videoElement.currentTime = start + clampedRelative;
      setCurrentTime(clampedRelative);
    }
  };

  const handleRateChange = (rate: number) => {
    videoRefs.current.forEach((videoElement, tileIndex) => {
      if (!videoElement || !slots[tileIndex]) return;
      videoElement.playbackRate = rate;
    });
    setPlaybackRate(rate);
  };

  const handleSelectVideo = (selectedVideo: Video) => {
    setSlot(index, selectedVideo);
    toast({ title: 'Video Added' });
  };

  const handleRemoveVideo = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSlot(index, null);
    toast({ title: 'Video Removed' });
  };

  // --- Step Logic for Fine Tuning ---
  const handleStep = (seconds: number) => {
    const videoElement = videoRef.current;
    if (videoElement) {
      const start = video?.trimStart ?? 0;
      const trimEnd = video?.trimEnd ?? videoElement.duration;
      const end = Number.isFinite(trimEnd) ? Math.max(start, trimEnd) : start;
      const clampTime = (time: number) => Math.max(start, Math.min(time, end));

      if (isSyncEnabled) {
        const currentOffset = syncOffsets[index] ?? 0;
        const nextOffset = clampTime(start + currentOffset + seconds) - start;
        updateSyncOffset(index, nextOffset - currentOffset);
        videoElement.currentTime = clampTime(videoElement.currentTime + seconds);
      } else {
        videoElement.currentTime = clampTime(videoElement.currentTime + seconds);
      }
      setCurrentTime(Math.max(0, videoElement.currentTime - start));
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
          <span className="font-mono font-bold text-xs" style={{ fontSize: size / 2.2 }}>
            {label}
          </span>
        </div>
      </button>
    );
  };

  // --- Zoom and Pan Logic ---

  const handleZoom = useCallback((delta: number, clientX: number, clientY: number) => {
    if (isDrawingEnabled && isActive) return; // Disable zoom/pan via mouse/wheel when drawing

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
  }, [scale, position, index, setZoomLevel, setPanPosition, isDrawingEnabled, isActive]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (isDrawingEnabled && isActive) return;
    e.preventDefault();
    e.stopPropagation();
    const zoomSensitivity = 0.001;
    const delta = -e.deltaY * zoomSensitivity;
    handleZoom(delta, e.clientX, e.clientY);
  }, [handleZoom, isDrawingEnabled, isActive]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isDrawingEnabled && isActive) return; // Let DrawingCanvas handle events
    if (scale > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
      e.stopPropagation();
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDrawingEnabled && isActive) return;
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
    if (isDrawingEnabled && isActive) return;

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
    if (isDrawingEnabled && isActive) return;

    if (e.touches.length === 2 && lastTouchDistance.current !== null) {
      e.preventDefault(); // Prevent page scroll/zoom
      const dist = getDistance(e.touches[0], e.touches[1]);
      const center = getCenter(e.touches[0], e.touches[1]);
      const scaleFactor = dist / lastTouchDistance.current;
      const delta = (scale * scaleFactor) - scale;
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
        className="absolute top-2 right-2 z-30 h-10 w-10 bg-black/55 hover:bg-destructive/90 text-white opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity rounded-full backdrop-blur-sm"
        onClick={handleRemoveVideo}
        title="Remove video from slot"
        aria-label="Remove video from slot"
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

        {/* Drawing Canvas Overlay */}
        {video && (
          <PoseOverlay
            enabled={shouldAnalyzePose}
            videoElement={videoElement}
            scale={scale}
            position={position}
            objectFit={isPortraitMode ? 'cover' : 'contain'}
            modelVariant={poseModelVariant}
            targetFps={poseTargetFps}
            minVisibility={poseMinVisibility}
            minPoseDetectionConfidence={poseMinPoseDetectionConfidence}
            minPosePresenceConfidence={poseMinPosePresenceConfidence}
            minTrackingConfidence={poseMinTrackingConfidence}
          />
        )}

        {video && (
          <DrawingCanvas
            scale={scale}
            position={position}
            tool={drawingTool}
            color={drawingColor}
            isActive={isDrawingEnabled && isActive}
            drawings={currentDrawings}
            onDrawingsChange={(newDrawings) => setDrawingsForVideo(video.id, newDrawings)}
          />
        )}
      </div>

      {/* Controls Overlay */}
      <div className="z-20 bg-gradient-to-t from-black/90 via-black/50 to-transparent pb-1 pt-4 px-2 flex flex-col gap-2">
        {/* Step buttons bar - Added Back */}
        <div
          className="flex items-center justify-center gap-2 py-1"
          onClick={e => e.stopPropagation()}
        >
          {renderStepBtn(-0.5, 28)}
          {renderStepBtn(-0.1, 28)}
          {renderStepBtn(-1 / 30, 28, '-1f')}
          <div className="w-px h-4 bg-white/20 mx-1" />
          {renderStepBtn(1 / 30, 28, '+1f')}
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
