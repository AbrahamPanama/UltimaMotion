'use client';

import { Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import React from 'react';

interface PlayerControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  currentTime: number;
  duration: number;
  onSeek: (time: number) => void;
  playbackRate: number;
  onRateChange: (rate: number) => void;
  isSyncEnabled: boolean;
  variant?: 'overlay' | 'static';
}

const PLAYBACK_RATES = [1.0, 0.5, 0.25, 0.125];
const FRAME_STEP = 1 / 30; // Assume 30fps for stepping

export default function PlayerControls({
  isPlaying,
  onPlayPause,
  currentTime,
  duration,
  onSeek,
  playbackRate,
  onRateChange,
  isSyncEnabled,
  variant = 'overlay',
}: PlayerControlsProps) {
  
  // Format time as M:SS
  const formatTime = (time: number) => {
    if (isNaN(time)) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const isOverlay = variant === 'overlay';
  const timeTextClass = isOverlay
    ? "text-white/90 shadow-black/50 drop-shadow-sm"
    : "text-foreground";
  const timeTextMutedClass = isOverlay
    ? "text-white/70 shadow-black/50 drop-shadow-sm"
    : "text-muted-foreground";
  const iconButtonClass = isOverlay
    ? "text-white/90 hover:text-white hover:bg-white/20"
    : "text-foreground hover:text-foreground hover:bg-secondary";
  const iconButtonPrimaryClass = isOverlay
    ? "text-white hover:text-white hover:bg-white/20"
    : "text-foreground hover:text-foreground hover:bg-secondary";
  const speedTriggerClass = isOverlay
    ? "bg-black/60 border-white/20 text-white hover:bg-black/80 hover:border-white/40"
    : "bg-background border-border text-foreground hover:bg-secondary";
  const speedContentClass = isOverlay
    ? "min-w-[80px] bg-black/90 text-white border-white/20"
    : "min-w-[80px] bg-popover text-popover-foreground border-border";
  const speedItemClass = isOverlay
    ? "text-xs focus:bg-white/20 focus:text-white text-white/80"
    : "text-xs";

  // In sync mode, show a prominent badge/overlay
  if (isSyncEnabled) {
    return (
      <div className={cn(
        "flex items-center justify-center w-full",
        isOverlay ? "absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity opacity-0 group-hover:opacity-100" : "py-2 bg-primary/10 rounded-md"
      )}>
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/20 rounded-full border border-primary/30">
             <div className="w-2 h-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(168,85,247,0.8)]" />
             <span className="text-primary font-bold text-sm tracking-wide uppercase">Sync Active</span>
        </div>
      </div>
    );
  }

  const handleSeekChange = (value: number[]) => {
    onSeek(value[0]);
  };
  
  const handleStepBack = (e: React.MouseEvent) => { 
    e.stopPropagation(); 
    if (isPlaying) {
      onPlayPause();
    }
    onSeek(Math.max(0, currentTime - FRAME_STEP)); 
  };

  const handleStepForward = (e: React.MouseEvent) => { 
    e.stopPropagation(); 
    if (isPlaying) {
      onPlayPause();
    }
    onSeek(Math.min(duration, currentTime + FRAME_STEP)); 
  };
  
  const handlePlayClick = (e: React.MouseEvent) => { e.stopPropagation(); onPlayPause(); };


  return (
    <div
      className={cn(
        "w-full flex flex-col gap-2 transition-opacity duration-200",
        isOverlay ? "opacity-0 group-hover:opacity-100" : ""
      )}
      onClick={(e) => e.stopPropagation()}
    >
        {/* Progress Bar Row */}
        <div className="flex items-center gap-3 px-1">
             <span className={cn("text-xs font-mono font-medium w-[35px] text-right tabular-nums", timeTextClass)}>
                {formatTime(currentTime)}
             </span>
             
                 <div className="flex-1 relative group/slider py-2 cursor-pointer">
                <Slider
                    value={[currentTime]}
                    min={0}
                    max={duration || 100}
                    step={0.01}
                    onValueChange={handleSeekChange}
                    className={cn(
                      "cursor-pointer",
                      !isOverlay && "[&>span:first-child]:bg-secondary [&>span:first-child]:border-border [&>span:first-child>span]:bg-primary"
                    )}
                />
             </div>

             <span className={cn("text-xs font-mono font-medium w-[35px] tabular-nums", timeTextMutedClass)}>
                {formatTime(duration)}
             </span>
        </div>

        {/* Controls Row */}
        <div className="flex items-center justify-between px-1">
            
            {/* Playback Controls Group */}
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-8 w-8 rounded-full transition-colors", iconButtonClass)}
                    onClick={handleStepBack}
                    title="Previous Frame"
                >
                    <SkipBack className="h-4 w-4 fill-current" />
                </Button>
                
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-8 w-8 rounded-full transition-colors", iconButtonPrimaryClass)}
                    onClick={handlePlayClick}
                    title={isPlaying ? "Pause" : "Play"}
                >
                    {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current ml-0.5" />}
                </Button>

                <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-8 w-8 rounded-full transition-colors", iconButtonClass)}
                    onClick={handleStepForward}
                    title="Next Frame"
                >
                    <SkipForward className="h-4 w-4 fill-current" />
                </Button>
            </div>

            {/* Right Side Controls */}
             <div className="flex items-center gap-2">
                 {/* Playback Speed Selector */}
                 <Select
                    value={playbackRate.toString()}
                    onValueChange={(val) => onRateChange(parseFloat(val))}
                  >
                    <SelectTrigger 
                        className={cn("h-7 w-[70px] transition-colors focus:ring-0 focus:ring-offset-0", speedTriggerClass)}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end" className={speedContentClass}>
                      {PLAYBACK_RATES.map((rate) => (
                        <SelectItem 
                            key={rate} 
                            value={rate.toString()} 
                            className={speedItemClass}
                        >
                          {rate}x
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
             </div>
        </div>
    </div>
  );
}
