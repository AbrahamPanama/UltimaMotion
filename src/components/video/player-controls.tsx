'use client';

import { Play, Pause } from 'lucide-react';
import { Button } from '../ui/button';
import { Slider } from '../ui/slider';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { cn } from '@/lib/utils';

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

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  // In overlay mode, if sync is on, show the "Sync Active" badge instead of controls
  if (isSyncEnabled && variant === 'overlay') {
    return (
      <div className="absolute inset-0 bg-black/50 flex items-center justify-center backdrop-blur-sm transition-opacity opacity-0 group-hover:opacity-100">
        <p className="text-white font-medium text-lg">Sync Active</p>
      </div>
    );
  }

  // In static mode, if sync is on, show a compact label
  if (isSyncEnabled && variant === 'static') {
    return (
      <div className="w-full py-1 px-2 bg-muted/50 text-center">
        <p className="text-xs text-muted-foreground font-medium">Sync Active</p>
      </div>
    );
  }

  const isOverlay = variant === 'overlay';

  return (
    <div
      className={cn(
        "flex flex-col gap-2",
        isOverlay
          ? "absolute bottom-0 left-0 right-0 p-2 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          : "w-full"
      )}
    >
      <div className={cn("flex items-center gap-2", isOverlay ? "text-white" : "text-foreground")}>
        <Button
          variant="ghost"
          size="icon"
          onClick={onPlayPause}
          className={cn(isOverlay ? "hover:bg-white/20" : "hover:bg-accent")}
        >
          {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </Button>

        <span className="text-xs font-mono w-12">{formatTime(currentTime)}</span>

        <Slider
          min={0}
          max={duration || 1}
          step={0.1}
          value={[currentTime]}
          onValueChange={(value) => onSeek(value[0])}
          className="w-full"
        />

        <span className="text-xs font-mono w-12 text-right">{formatTime(duration)}</span>

        <Select
          value={playbackRate.toString()}
          onValueChange={(value) => onRateChange(parseFloat(value))}
        >
          <SelectTrigger
            className={cn(
              "w-[80px] h-8",
              isOverlay
                ? "bg-black/30 border-white/30 text-white"
                : "bg-background border-input text-foreground"
            )}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLAYBACK_RATES.map((rate) => (
              <SelectItem key={rate} value={rate.toString()}>{rate.toFixed(2)}x</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
