'use client';
import { useAppContext } from '@/contexts/app-context';
import { Button } from '@/components/ui/button';
import { Smartphone, Repeat, Radio, Volume2, VolumeX } from 'lucide-react';
import DrawingToolbar from './drawing-toolbar';
import { cn } from '@/lib/utils';

export default function MainControls() {
  const { 
    isSyncEnabled, 
    toggleSync, 
    isPortraitMode, 
    togglePortraitMode, 
    isLoopEnabled, 
    toggleLoop, 
    isMuted, 
    toggleMute 
  } = useAppContext();

  const toggleButtonClasses = (active: boolean, tone: 'primary' | 'destructive' = 'primary') =>
    cn(
      'h-10 w-full justify-start px-3 gap-2 rounded-md border text-sm font-medium transition-colors',
      active
        ? tone === 'destructive'
          ? 'bg-destructive/10 text-destructive border-destructive/35 hover:bg-destructive/15'
          : 'bg-primary/10 text-primary border-primary/35 hover:bg-primary/15'
        : 'bg-background text-foreground border-border hover:bg-secondary'
    );

  const statePillClasses = (active: boolean, tone: 'primary' | 'destructive' = 'primary') =>
    cn(
      'ml-auto inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none',
      active
        ? tone === 'destructive'
          ? 'border-destructive/35 bg-destructive/10 text-destructive'
          : 'border-primary/35 bg-primary/10 text-primary'
        : 'border-border bg-secondary/50 text-muted-foreground'
    );

  return (
    <div className="w-full max-w-6xl mx-auto rounded-xl border border-border/70 bg-card/95 shadow-sm px-4 py-3 sm:px-5 sm:py-4">
      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        <section className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Playback & Analysis</p>
          <div className="flex-1 rounded-lg border border-border/70 bg-secondary/20 p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleMute}
                className={toggleButtonClasses(isMuted, 'destructive')}
                aria-pressed={isMuted}
                title={isMuted ? 'Unmute audio' : 'Mute audio'}
              >
                {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                <span>Mute</span>
                <span className={statePillClasses(isMuted, 'destructive')}>{isMuted ? 'On' : 'Off'}</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={toggleLoop}
                className={toggleButtonClasses(isLoopEnabled)}
                aria-pressed={isLoopEnabled}
                title="Loop playback"
              >
                <Repeat className="h-4 w-4" />
                <span>Loop</span>
                <span className={statePillClasses(isLoopEnabled)}>{isLoopEnabled ? 'On' : 'Off'}</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={togglePortraitMode}
                className={toggleButtonClasses(isPortraitMode)}
                aria-pressed={isPortraitMode}
                title="Portrait framing"
              >
                <Smartphone className="h-4 w-4" />
                <span>Portrait</span>
                <span className={statePillClasses(isPortraitMode)}>{isPortraitMode ? 'On' : 'Off'}</span>
              </Button>

              <Button
                variant="ghost"
                size="sm"
                onClick={toggleSync}
                className={toggleButtonClasses(isSyncEnabled)}
                aria-pressed={isSyncEnabled}
                title="Sync all active videos"
              >
                <Radio className={cn('h-4 w-4', isSyncEnabled && 'animate-pulse')} />
                <span>Sync</span>
                <span className={statePillClasses(isSyncEnabled)}>{isSyncEnabled ? 'On' : 'Off'}</span>
              </Button>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Annotate</p>
          <div className="flex-1 rounded-lg border border-border/70 bg-secondary/20 p-3">
            <DrawingToolbar className="h-full w-full border-0 bg-transparent p-0 shadow-none" />
          </div>
        </section>
      </div>
    </div>
  );
}
