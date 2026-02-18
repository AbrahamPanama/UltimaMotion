'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Wand2, Play, Pause, RotateCcw } from 'lucide-react';
import { generateFilmstrip } from '@/lib/video-utils';

interface TrimDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blob: Blob | null;
  initialName: string;
  onSave: (name: string, trimStart: number, trimEnd: number) => void;
}

export function TrimDialog({ open, onOpenChange, blob, initialName, onSave }: TrimDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState([0, 0]); // [start, end]
  const [name, setName] = useState(initialName);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // Initialize video URL and Duration
  useEffect(() => {
    if (blob) {
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);

      // Reset state for new video
      setRange([0, 0]);
      setIsPlaying(false);
      setThumbnails([]);
      setCurrentTime(0);

      return () => URL.revokeObjectURL(url);
    }
  }, [blob]);

  // Sync name when initialName changes OR when a new blob is loaded
  useEffect(() => {
    setName(initialName);
  }, [initialName, blob]);

  // Generate Thumbnails (iOS-compatible)
  useEffect(() => {
    if (!blob) return;

    let cancelled = false;

    const run = async () => {
      setIsGeneratingThumbnails(true);
      const result = await generateFilmstrip(blob);
      if (!cancelled) {
        setThumbnails(result.thumbnails);
        setIsGeneratingThumbnails(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [blob]);

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      setDuration(dur);
      setRange([0, dur]);
      setCurrentTime(0);
    }
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const [start, end] = range;
      setCurrentTime(videoRef.current.currentTime);
      if (videoRef.current.currentTime >= end && !videoRef.current.paused) {
        videoRef.current.currentTime = start;
        setCurrentTime(start);
        videoRef.current.play().catch(() => { });
      }
    }
  };

  const handleEnded = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = range[0];
      setCurrentTime(range[0]);
      videoRef.current.play().catch(() => { });
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play().catch(() => { });
      } else {
        videoRef.current.pause();
      }
    }
  };

  const onPlay = () => setIsPlaying(true);
  const onPause = () => setIsPlaying(false);

  const handleSliderChange = (newRange: number[]) => {
    const oldRange = range;
    setRange(newRange);

    const startChanged = Math.abs(newRange[0] - oldRange[0]) > 0.001;
    const endChanged = Math.abs(newRange[1] - oldRange[1]) > 0.001;

    if (videoRef.current) {
      if (!videoRef.current.paused) {
        videoRef.current.pause();
      }

      if (startChanged) {
        videoRef.current.currentTime = newRange[0];
        setCurrentTime(newRange[0]);
      } else if (endChanged) {
        videoRef.current.currentTime = newRange[1];
        setCurrentTime(newRange[1]);
      }
    }
  };

  const handleAutoTrim = () => {
    if (duration > 0) {
      const suggestedStart = duration * 0.1;
      const suggestedEnd = duration * 0.9;

      setRange([suggestedStart, suggestedEnd]);
      if (videoRef.current) {
        videoRef.current.currentTime = suggestedStart;
        setCurrentTime(suggestedStart);
      }
    }
  };

  const handleReset = () => {
    setRange([0, duration]);
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      setCurrentTime(0);
    }
  };

  const handleNudge = (target: 'start' | 'end', delta: number) => {
    const [start, end] = range;
    const step = 0.1;
    if (target === 'start') {
      const nextStart = Math.max(0, Math.min(start + delta * step, end - step));
      const nextRange: [number, number] = [nextStart, end];
      setRange(nextRange);
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = nextStart;
      }
      setCurrentTime(nextStart);
      return;
    }

    const nextEnd = Math.min(duration, Math.max(end + delta * step, start + step));
    const nextRange: [number, number] = [start, nextEnd];
    setRange(nextRange);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = nextEnd;
    }
    setCurrentTime(nextEnd);
  };

  const handleSave = () => {
    onSave(name, range[0], range[1]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-0.5rem)] max-h-[calc(100svh-0.5rem)] sm:max-w-[980px] bg-card border-none shadow-2xl p-3 sm:p-6 rounded-md sm:rounded-lg">
        <DialogHeader className="space-y-1">
          <DialogTitle className="font-headline text-2xl tracking-tight text-foreground">Review & Trim</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Adjust the timeline to isolate the action.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6 mt-2">
          {/* Player Container */}
          <div className="relative aspect-video bg-black rounded-lg overflow-hidden border border-white/10 shadow-lg group">
            {videoUrl && (
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain"
                playsInline
                muted
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleEnded}
                onPlay={onPlay}
                onPause={onPause}
                onClick={togglePlay}
              />
            )}
            {!isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none bg-black/20">
                <div className="bg-primary/90 p-4 rounded-full shadow-xl backdrop-blur-md transform transition-transform group-hover:scale-110">
                  <Play className="w-8 h-8 text-primary-foreground fill-current ml-1" />
                </div>
              </div>
            )}
          </div>

          {/* Controls Area */}
          <div className="flex flex-col gap-4 px-2">

            {/* Timestamps Row */}
            <div className="flex flex-wrap items-end justify-between gap-2 text-xs font-mono font-medium tracking-wide">
              <span className="text-primary/90">Start: {range[0].toFixed(2)}s</span>
              <span className="text-muted-foreground">Clip: {(range[1] - range[0]).toFixed(2)}s</span>
              <span className="text-primary/90">End: {range[1].toFixed(2)}s</span>
            </div>

            {/* Timeline / Filmstrip */}
            <div className="relative h-16 w-full rounded-md overflow-hidden ring-1 ring-white/10 shadow-inner bg-black/40 select-none">
              {/* Thumbnails */}
              <div className="absolute inset-0 flex w-full h-full opacity-80 transition-opacity hover:opacity-100">
                {thumbnails.map((thumb, idx) => (
                  <div key={idx} className="h-full flex-none relative border-r border-white/5 last:border-r-0">
                    <img
                      src={thumb}
                      alt={`frame-${idx}`}
                      className="h-full w-auto object-cover block"
                    />
                  </div>
                ))}
                {thumbnails.length === 0 && isGeneratingThumbnails && (
                  <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground w-full animate-pulse">
                    Generating preview...
                  </div>
                )}
              </div>

              {/* Slider Overlay */}
              <div className="absolute inset-0 flex items-center">
                <Slider
                  value={range}
                  min={0}
                  max={duration}
                  step={0.05}
                  minStepsBetweenThumbs={1}
                  onValueChange={handleSliderChange}
                  className="h-full py-0 group/slider [&>span:first-child]:h-full [&>span:first-child]:bg-transparent [&>span:first-child]:rounded-none cursor-pointer [&_[role=slider]]:h-7 [&_[role=slider]]:w-7 sm:[&_[role=slider]]:h-5 sm:[&_[role=slider]]:w-5 [&_[role=slider]]:border-2 [&_[role=slider]]:shadow-md"
                />
              </div>
              {duration > 0 && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-primary/80 pointer-events-none shadow-[0_0_0_1px_rgba(255,255,255,0.2)]"
                  style={{
                    left: `${Math.min(100, Math.max(0, (currentTime / duration) * 100))}%`,
                  }}
                />
              )}
            </div>

            {/* Actions Toolbar */}
            <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
              <div className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">Trim Controls</div>
              <div className="flex items-center gap-2 sm:hidden">
                <Button variant="ghost" size="sm" onClick={handleAutoTrim} className="h-8 text-xs text-muted-foreground hover:text-accent hover:bg-accent/10">
                  <Wand2 className="w-3.5 h-3.5 mr-2" />
                  Auto
                </Button>
                <Button variant="ghost" size="sm" onClick={handleReset} className="h-8 text-xs text-muted-foreground hover:text-foreground">
                  <RotateCcw className="w-3.5 h-3.5 mr-2" />
                  Reset
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={togglePlay}
                  className="ml-auto h-8 rounded-full border-primary/20 bg-background/50 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all shadow-sm group"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-4 h-4 fill-current text-primary group-hover:text-primary-foreground mr-1" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current text-primary group-hover:text-primary-foreground ml-0.5 mr-1" />
                      Play
                    </>
                  )}
                </Button>
              </div>
              <div className="hidden sm:flex flex-wrap items-center justify-between gap-2">
                <Button variant="ghost" size="sm" onClick={handleAutoTrim} className="text-xs h-8 text-muted-foreground hover:text-accent hover:bg-accent/10">
                  <Wand2 className="w-3.5 h-3.5 mr-2" />
                  Auto
                </Button>
                <Button variant="ghost" size="sm" onClick={handleReset} className="text-xs h-8 text-muted-foreground hover:text-foreground">
                  <RotateCcw className="w-3.5 h-3.5 mr-2" />
                  Reset
                </Button>
                <div className="flex items-center gap-1 rounded-md border border-border/60 bg-background/70 p-1">
                  <Button variant="ghost" size="sm" onClick={() => handleNudge('start', -1)} className="h-7 px-2 text-xs">Start -0.1s</Button>
                  <Button variant="ghost" size="sm" onClick={() => handleNudge('start', 1)} className="h-7 px-2 text-xs">Start +0.1s</Button>
                  <Button variant="ghost" size="sm" onClick={() => handleNudge('end', -1)} className="h-7 px-2 text-xs">End -0.1s</Button>
                  <Button variant="ghost" size="sm" onClick={() => handleNudge('end', 1)} className="h-7 px-2 text-xs">End +0.1s</Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={togglePlay}
                  className="h-8 rounded-full border-primary/20 bg-background/50 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all shadow-sm group"
                >
                  {isPlaying ? (
                    <>
                      <Pause className="w-4 h-4 fill-current text-primary group-hover:text-primary-foreground mr-1" />
                      Pause
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 fill-current text-primary group-hover:text-primary-foreground ml-0.5 mr-1" />
                      Play
                    </>
                  )}
                </Button>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground font-mono">
                <span>Preview: {currentTime.toFixed(2)}s</span>
                <span className="sm:hidden">Drag handles to fine trim</span>
              </div>
            </div>
          </div>

          {/* Footer - Name Input & Save */}
          <div className="grid w-full items-center gap-1.5 border-t border-border/40 pt-3">
            <Label htmlFor="video-name" className="text-xs text-muted-foreground">Clip Name</Label>
            <Input
              id="video-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-secondary/20 border-white/10 focus-visible:ring-primary/50"
            />
          </div>
          <div className="sticky bottom-0 z-10 -mx-3 sm:-mx-6 mt-1 bg-card/95 backdrop-blur-sm border-t border-border/40 px-3 sm:px-6 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] sm:pb-3">
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => onOpenChange(false)}>Close</Button>
              <Button onClick={handleSave} className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground font-medium shadow-lg shadow-primary/20">
                Save to Library
              </Button>
            </div>
          </div>
        </div>
        {/* Footer removed from DialogContent standard slot to customize layout above */}
      </DialogContent>
    </Dialog>
  );
}
