'use client';

import { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Wand2, Play, Pause } from 'lucide-react';

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

  // Initialize video URL and Duration
  useEffect(() => {
    if (blob) {
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      
      // Reset state for new video
      setRange([0, 0]);
      setIsPlaying(false);
      setName(initialName);

      return () => URL.revokeObjectURL(url);
    }
  }, [blob, initialName]);

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      setDuration(dur);
      setRange([0, dur]); // Default to full length
    }
  };

  // Enforce the trim loop
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const [start, end] = range;
      // If we go past the end, loop back to start
      if (videoRef.current.currentTime >= end) {
        videoRef.current.currentTime = start;
        if (!isPlaying) videoRef.current.pause(); 
        else videoRef.current.play();
      }
    }
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

  const handleSliderChange = (newRange: number[]) => {
    setRange(newRange);
    // If the user moves the start handle, seek the video there so they see the frame
    if (videoRef.current && Math.abs(videoRef.current.currentTime - newRange[0]) > 0.1) {
      videoRef.current.currentTime = newRange[0];
    }
  };

  // 🪄 The "Auto-Trim" Simulation
  const handleAutoTrim = () => {
    if (duration > 0) {
      // Logic placeholder: Detect "static" frames at start/end.
      // For now, we simulate finding action starting at 10% and ending at 90%.
      const suggestedStart = duration * 0.1; 
      const suggestedEnd = duration * 0.9;
      
      setRange([suggestedStart, suggestedEnd]);
      if (videoRef.current) {
        videoRef.current.currentTime = suggestedStart;
      }
    }
  };

  const handleSave = () => {
    onSave(name, range[0], range[1]);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] bg-card">
        <DialogHeader>
          <DialogTitle>Review & Trim</DialogTitle>
          <DialogDescription>
            Adjust the start and end points to isolate the action.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Player Container */}
          <div className="relative aspect-video bg-black rounded-md overflow-hidden border border-border">
            {videoUrl && (
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full h-full object-contain"
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onClick={togglePlay}
              />
            )}
            {!isPlaying && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/50 p-3 rounded-full backdrop-blur-sm">
                  <Play className="w-8 h-8 text-white fill-white" />
                </div>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="space-y-4 px-2">
            <div className="flex items-center justify-between text-xs font-mono text-muted-foreground">
              <span>{range[0].toFixed(2)}s</span>
              <span>{range[1].toFixed(2)}s</span>
            </div>
            
            <Slider
              value={range}
              min={0}
              max={duration}
              step={0.05}
              minStepsBetweenThumbs={1}
              onValueChange={handleSliderChange}
              className="py-4"
            />

            <div className="flex items-center gap-2">
               <Button size="sm" variant="secondary" onClick={handleAutoTrim} className="text-xs">
                 <Wand2 className="w-3.5 h-3.5 mr-2" />
                 Auto-Trim
               </Button>
               <div className="flex-1" />
               <Button size="icon" variant="ghost" onClick={togglePlay}>
                 {isPlaying ? <Pause className="w-4 h-4"/> : <Play className="w-4 h-4"/>}
               </Button>
            </div>
          </div>

          {/* Name Input */}
          <div className="grid w-full items-center gap-1.5">
            <Label htmlFor="video-name">Video Name</Label>
            <Input 
              id="video-name" 
              value={name} 
              onChange={(e) => setName(e.target.value)} 
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Discard</Button>
          <Button onClick={handleSave}>Save to Library</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
