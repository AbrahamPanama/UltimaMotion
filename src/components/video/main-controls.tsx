'use client';
import { useAppContext } from '@/contexts/app-context';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { LayoutGrid, Square, Rows, Smartphone, Repeat, Radio, Volume2, VolumeX } from 'lucide-react';

export default function MainControls() {
  const { 
    setLayout, 
    layout,
    isSyncEnabled, 
    toggleSync, 
    isPortraitMode, 
    togglePortraitMode, 
    isLoopEnabled, 
    toggleLoop, 
    isMuted, 
    toggleMute 
  } = useAppContext();

  return (
    <div className="w-full max-w-4xl mx-auto p-4 bg-card/80 backdrop-blur-md border border-border/50 rounded-xl shadow-sm space-y-4">
      
      {/* Top Row: Layout & Global Toggles */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        
        {/* Layout Selectors */}
        <div className="flex items-center gap-2 bg-secondary/30 p-1 rounded-lg">
          <Button
            variant={layout === 1 ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setLayout(1)}
            className="w-10 h-8"
            title="Single View"
          >
            <Square className="h-4 w-4" />
          </Button>
          <Button
            variant={layout === 2 ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setLayout(2)}
            className="w-10 h-8"
            title="Split View"
          >
            <Rows className="h-4 w-4 rotate-90 sm:rotate-0" />
          </Button>
          <Button
            variant={layout === 4 ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setLayout(4)}
            className="w-10 h-8"
            title="Grid View"
          >
            <LayoutGrid className="h-4 w-4" />
          </Button>
        </div>

        <div className="h-6 w-px bg-border hidden sm:block" />

        {/* Global Controls */}
        <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6">
          
          {/* Mute Toggle */}
           <Button
            variant="ghost"
            size="sm"
            onClick={toggleMute}
            className={`gap-2 ${isMuted ? 'text-destructive hover:text-destructive/90' : 'text-foreground'}`}
            title={isMuted ? 'Unmute all' : 'Mute all'}
          >
            {isMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            <span className="hidden sm:inline text-sm font-medium">{isMuted ? 'Muted' : 'Sound'}</span>
          </Button>

           {/* Loop Toggle */}
          <div className="flex items-center gap-2">
             <Button
                variant="ghost"
                size="sm"
                onClick={toggleLoop}
                className={`gap-2 ${isLoopEnabled ? 'text-primary' : 'text-muted-foreground'}`}
             >
                <Repeat className="h-4 w-4" />
                <span className="text-sm font-medium">Loop</span>
             </Button>
             <Switch
                id="loop-mode"
                checked={isLoopEnabled}
                onCheckedChange={toggleLoop}
                className="scale-75"
             />
          </div>

          {/* Portrait Toggle */}
          <div className="flex items-center gap-2">
             <Button
                variant="ghost"
                size="sm"
                onClick={togglePortraitMode}
                className={`gap-2 ${isPortraitMode ? 'text-primary' : 'text-muted-foreground'}`}
             >
                <Smartphone className="h-4 w-4" />
                <span className="text-sm font-medium">Portrait</span>
             </Button>
             <Switch
                id="portrait-mode"
                checked={isPortraitMode}
                onCheckedChange={togglePortraitMode}
                 className="scale-75"
             />
          </div>

          {/* Sync Toggle */}
          <div className="flex items-center gap-2 pl-2 border-l border-border/50">
             <Button
                variant="ghost"
                size="sm"
                onClick={toggleSync}
                className={`gap-2 ${isSyncEnabled ? 'text-primary' : 'text-muted-foreground'}`}
             >
                <Radio className={`h-4 w-4 ${isSyncEnabled ? 'animate-pulse' : ''}`} />
                <span className="text-sm font-medium">Sync</span>
             </Button>
             <Switch
                id="sync-mode"
                checked={isSyncEnabled}
                onCheckedChange={toggleSync}
                 className="scale-75"
             />
          </div>

        </div>
      </div>
    </div>
  );
}
