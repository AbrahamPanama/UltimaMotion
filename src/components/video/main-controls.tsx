'use client';
import { useAppContext } from '@/contexts/app-context';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Square, Rows, Grid, RadioTower, Smartphone, Repeat, Volume2, VolumeX } from 'lucide-react';

export default function MainControls() {
  const { layout, setLayout, isSyncEnabled, toggleSync, isPortraitMode, togglePortraitMode, isLoopEnabled, toggleLoop, isMuted, toggleMute } = useAppContext();

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-2 border rounded-lg bg-card">
      <div className="flex items-center gap-2">
        <Label>Layout:</Label>
        <Button
          variant={layout === 1 ? 'default' : 'ghost'}
          size="icon"
          onClick={() => setLayout(1)}
        >
          <Square className="h-5 w-5" />
          <span className="sr-only">1 Tile Layout</span>
        </Button>
        <Button
          variant={layout === 2 ? 'default' : 'ghost'}
          size="icon"
          onClick={() => setLayout(2)}
        >
          <Rows className="h-5 w-5" />
          <span className="sr-only">2 Tile Layout</span>
        </Button>
        <Button
          variant={layout === 4 ? 'default' : 'ghost'}
          size="icon"
          onClick={() => setLayout(4)}
        >
          <Grid className="h-5 w-5" />
          <span className="sr-only">4 Tile Layout</span>
        </Button>
      </div>
      <div className="flex items-center gap-4">
        <Button
          variant={isMuted ? 'default' : 'ghost'}
          size="icon"
          onClick={toggleMute}
          title={isMuted ? 'Unmute audio' : 'Mute audio'}
        >
          {isMuted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </Button>
        <div className="flex items-center space-x-2">
          <Repeat className="h-5 w-5 text-muted-foreground" />
          <Label htmlFor="loop-mode" className="font-medium">
            Loop
          </Label>
          <Switch
            id="loop-mode"
            checked={isLoopEnabled}
            onCheckedChange={toggleLoop}
          />
        </div>
        <div className="flex items-center space-x-2">
          <Smartphone className="h-5 w-5 text-muted-foreground" />
          <Label htmlFor="portrait-mode" className="font-medium">
            Portrait
          </Label>
          <Switch
            id="portrait-mode"
            checked={isPortraitMode}
            onCheckedChange={togglePortraitMode}
          />
        </div>
        <div className="flex items-center space-x-2">
          <RadioTower className="h-5 w-5 text-muted-foreground" />
          <Label htmlFor="sync-mode" className="font-medium">
            Sync Playback
          </Label>
          <Switch
            id="sync-mode"
            checked={isSyncEnabled}
            onCheckedChange={toggleSync}
          />
        </div>
      </div>
    </div>
  );
}
