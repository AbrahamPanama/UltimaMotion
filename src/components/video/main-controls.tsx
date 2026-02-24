'use client';
import { useState } from 'react';
import { useAppContext } from '@/contexts/app-context';
import { Button } from '@/components/ui/button';
import { Repeat, Volume2, VolumeX, ChevronDown } from 'lucide-react';
import DrawingToolbar from './drawing-toolbar';
import { cn } from '@/lib/utils';

export default function MainControls() {
  const {
    isLoopEnabled,
    toggleLoop,
    isMuted,
    toggleMute,
  } = useAppContext();

  const [isOpen, setIsOpen] = useState(true);

  return (
    <div className="w-full rounded-xl border border-border/70 bg-card/95 shadow-sm">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="flex w-full items-center gap-3 group px-4 py-2.5"
        aria-expanded={isOpen}
      >
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground group-hover:text-foreground transition-colors">
          Controls
        </p>
        <span className="mx-1 h-px flex-1 bg-border/50" />
        <ChevronDown
          className={cn(
            'ml-1 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground transition-transform duration-200 group-hover:text-foreground',
            !isOpen && '-rotate-90'
          )}
        />
      </button>

      {isOpen && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 pb-3">
          {/* ── Playback Group ── */}
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleMute}
              className={cn(
                'h-9 w-9 rounded-md border transition-colors',
                isMuted
                  ? 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15'
                  : 'border-border/70 text-foreground hover:bg-secondary',
              )}
              aria-pressed={isMuted}
              title={isMuted ? 'Unmute audio' : 'Mute audio'}
            >
              {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              onClick={toggleLoop}
              className={cn(
                'h-9 w-9 rounded-md border transition-colors',
                isLoopEnabled
                  ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
                  : 'border-border/70 text-foreground hover:bg-secondary',
              )}
              aria-pressed={isLoopEnabled}
              title="Loop playback"
            >
              <Repeat className="h-4 w-4" />
            </Button>
          </div>

          {/* Separator */}
          <span className="mx-0.5 h-6 w-px bg-border/60 hidden sm:block" />

          {/* ── Drawing Toolbar (fills remaining space) ── */}
          <DrawingToolbar className="flex-1 min-w-0 border-0 bg-transparent p-0 shadow-none" />
        </div>
      )}
    </div>
  );
}
