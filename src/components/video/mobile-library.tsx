'use client';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useAppContext } from '@/contexts/app-context';
import { FilePlus, Trash2, PlusCircle, Video, ChevronUp, ChevronDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { VideoRecorder } from './video-recorder';
import { TrimDialog } from './trim-dialog';

export function MobileLibrary() {
  const { library, addVideoToLibrary, removeVideoFromLibrary, setSlot, slots } = useAppContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Collapse/expand state
  const [isCollapsed, setIsCollapsed] = useState(false);

  // State for Trim Dialog
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isTrimOpen, setIsTrimOpen] = useState(false);
  const [nextSegmentIndex, setNextSegmentIndex] = useState(0);

  useEffect(() => {
    if (pendingFile) {
      setNextSegmentIndex(0);
    }
  }, [pendingFile]);

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('video/')) {
        toast({ title: 'Error', description: 'Please select a valid video file.', variant: 'destructive' });
        return;
      }
      setPendingFile(file);
      setIsTrimOpen(true);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSaveTrimmed = async (name: string, trimStart: number, trimEnd: number) => {
    if (!pendingFile) return;

    const processVideo = (file: File): Promise<{ duration: number; thumbnail: string }> => {
      return new Promise((resolve) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        v.playsInline = true;
        v.onloadedmetadata = () => {
          v.currentTime = trimStart;
        };
        v.onseeked = () => {
          const duration = v.duration;
          const canvas = document.createElement('canvas');
          const scale = 320 / v.videoWidth;
          canvas.width = 320;
          canvas.height = v.videoHeight * scale;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
            resolve({ duration, thumbnail });
          } else {
            resolve({ duration, thumbnail: '' });
          }
        };
        v.onerror = () => {
          resolve({ duration: 0, thumbnail: '' });
        };
        v.src = URL.createObjectURL(file);
      });
    };

    const { duration, thumbnail } = await processVideo(pendingFile);

    await addVideoToLibrary({
      name,
      blob: pendingFile,
      duration,
      trimStart,
      trimEnd,
      thumbnail,
    });

    toast({ title: 'Segment Saved', description: `${name} added to your library.` });
    setNextSegmentIndex((prev) => prev + 1);
  };

  const handleDialogClose = (open: boolean) => {
    setIsTrimOpen(open);
    if (!open) {
      setTimeout(() => setPendingFile(null), 300);
    }
  };

  const handleAddToGrid = (video: import('@/types').Video) => {
    const emptySlotIndex = slots.findIndex((slot) => slot === null);
    if (emptySlotIndex !== -1) {
      setSlot(emptySlotIndex, video);
      toast({ title: 'Video Added', description: `"${video.name}" added to the grid.` });
    } else {
      toast({ title: 'Grid Full', description: 'All video slots are currently full.', variant: 'destructive' });
    }
  };

  return (
    <>
      <div className="bg-card border-t border-border flex-shrink-0">
        {/* Header Row */}
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold font-headline text-foreground">Library</h2>
            <span className="text-xs text-muted-foreground">({library.length})</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => fileInputRef.current?.click()}
              title="Import Video"
            >
              <FilePlus className="h-4 w-4" />
            </Button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileImport}
              accept="video/*"
              className="hidden"
            />
            <VideoRecorder />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setIsCollapsed(!isCollapsed)}
              title={isCollapsed ? 'Expand Library' : 'Collapse Library'}
            >
              {isCollapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Horizontal Filmstrip */}
        {!isCollapsed && (
          <div
            ref={scrollRef}
            className="flex gap-3 overflow-x-auto px-3 pb-3 snap-x snap-mandatory scrollbar-thin scrollbar-thumb-muted-foreground/20 scrollbar-track-transparent"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {library.length > 0 ? (
              library.map((video) => (
                <div
                  key={video.id}
                  className="group relative flex-shrink-0 w-[130px] snap-start cursor-pointer"
                  onClick={() => handleAddToGrid(video)}
                >
                  {/* Thumbnail */}
                  <div className="w-full aspect-video bg-black/10 rounded-lg overflow-hidden border border-border/30 relative shadow-sm">
                    {video.thumbnail ? (
                      <img
                        src={video.thumbnail}
                        alt={video.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full w-full bg-secondary/50">
                        <Video className="w-6 h-6 text-muted-foreground/50" />
                      </div>
                    )}

                    {/* Hover / touch overlay */}
                    <div className="absolute inset-0 bg-black/0 group-active:bg-black/20 transition-colors" />

                    {/* Quick Actions */}
                    <div className="absolute top-0.5 right-0.5 flex gap-0.5 opacity-0 group-active:opacity-100 transition-opacity">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5 bg-black/60 text-white hover:text-white hover:bg-black/80 rounded"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddToGrid(video);
                        }}
                        title="Add to Grid"
                      >
                        <PlusCircle className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5 bg-black/60 text-red-400 hover:text-red-300 hover:bg-black/80 rounded"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeVideoFromLibrary(video.id);
                        }}
                        title="Delete Video"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>

                    {/* Duration badge */}
                    <div className="absolute bottom-0.5 right-0.5 bg-black/70 text-white text-[10px] px-1 py-0.5 rounded font-medium">
                      {Math.round(video.duration)}s
                    </div>
                  </div>

                  {/* Name */}
                  <p className="text-[11px] font-medium text-foreground truncate mt-1 px-0.5" title={video.name}>
                    {video.name}
                  </p>
                  {video.trimStart !== undefined && (
                    <p className="text-[9px] text-primary font-semibold uppercase tracking-wider opacity-80 px-0.5">
                      Trimmed
                    </p>
                  )}
                </div>
              ))
            ) : (
              <div className="flex items-center gap-3 py-4 px-2 w-full">
                <Video className="w-8 h-8 text-muted-foreground/40 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-muted-foreground">No clips yet</p>
                  <p className="text-xs text-muted-foreground/70">Import or record a video to start</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <TrimDialog
        open={isTrimOpen}
        onOpenChange={handleDialogClose}
        blob={pendingFile}
        initialName={
          pendingFile
            ? `${pendingFile.name.replace(/\.[^/.]+$/, '')} - Segment ${nextSegmentIndex}`
            : 'New Video'
        }
        onSave={handleSaveTrimmed}
      />
    </>
  );
}
