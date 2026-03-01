'use client';
import { useState, useRef, useEffect } from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarTrigger,
  SidebarMenu,
  SidebarMenuItem,
  SidebarFooter
} from '@/components/ui/sidebar';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppContext } from '@/contexts/app-context';
import { extractThumbnail } from '@/lib/video-utils';
import { getPoseProcessModelLabel, POSE_PROCESS_MODEL_OPTIONS } from '@/lib/pose/pose-model-label';
import { FilePlus, Trash2, PlusCircle, Video, Loader2, CheckCircle2, AlertTriangle, Square, Star } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { VideoRecorder } from './video-recorder';
import { Separator } from '../ui/separator';
import { TrimDialog } from './trim-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { PoseModelVariant } from '@/types';

export function VideoLibrary() {
  const DUPLICATE_ADD_WINDOW_MS = 450;
  const {
    library,
    addVideoToLibrary,
    removeVideoFromLibrary,
    setSlot,
    slots,
    isPoseEnabled,
    processPoseForVideo,
    getPoseProcessingState,
    setPoseModelVariant,
    cancelPoseProcessing,
    toggleFavorite,
  } = useAppContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAddActionRef = useRef<{ videoId: string; atMs: number } | null>(null);
  const { toast } = useToast();

  // State for Trim Dialog
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [isTrimOpen, setIsTrimOpen] = useState(false);
  const [nextSegmentIndex, setNextSegmentIndex] = useState(0);

  // When a new file is loaded, reset the segment counter
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
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSaveTrimmed = async (name: string, trimStart: number, trimEnd: number) => {
    if (!pendingFile) return;

    const { duration, thumbnail } = await extractThumbnail(pendingFile, trimStart);

    await addVideoToLibrary({
      name: name,
      blob: pendingFile,
      duration: duration,
      trimStart,
      trimEnd,
      thumbnail,
    });

    toast({ title: "Segment Saved" });

    // Increment for next save
    setNextSegmentIndex(prev => prev + 1);
  };

  const handleDialogClose = (open: boolean) => {
    setIsTrimOpen(open);
    if (!open) {
      // When closing, clear the pending file so we start fresh next time
      setTimeout(() => setPendingFile(null), 300); // Small delay for animation
    }
  };

  const handleAddToGrid = async (video: import('@/types').Video) => {
    const nowMs = performance.now();
    const lastAdd = lastAddActionRef.current;
    if (lastAdd && lastAdd.videoId === video.id && (nowMs - lastAdd.atMs) < DUPLICATE_ADD_WINDOW_MS) {
      return;
    }
    lastAddActionRef.current = { videoId: video.id, atMs: nowMs };

    if (isPoseEnabled) {
      const poseState = getPoseProcessingState(video.id);
      if (poseState.status !== 'ready' || !poseState.modelVariant) {
        toast({ title: 'Pose not ready', description: 'Process this clip from the library before loading it.', variant: 'destructive' });
        return;
      }
      setPoseModelVariant(poseState.modelVariant);
    }

    const existingSlotIndex = slots.findIndex((slot) => slot?.id === video.id);
    if (existingSlotIndex !== -1) {
      // Re-assert slot placement to heal stale layout state from previous sessions.
      setSlot(existingSlotIndex, video);
      toast({ title: 'Video already in grid' });
      return;
    }

    const emptySlotIndex = slots.findIndex(slot => slot === null);
    if (emptySlotIndex !== -1) {
      setSlot(emptySlotIndex, video);
      toast({ title: 'Video Added' });
    } else {
      toast({ title: 'Grid Full', variant: 'destructive' });
    }
  };

  const handleProcessPose = async (video: import('@/types').Video, modelVariant: PoseModelVariant) => {
    const ok = await processPoseForVideo(video, modelVariant);
    if (ok) {
      setPoseModelVariant(modelVariant);
      toast({ title: `Pose Ready (${getPoseProcessModelLabel(modelVariant)})` });
    } else {
      const state = getPoseProcessingState(video.id);
      if (state.status === 'error') {
        toast({ title: 'Pose preprocessing failed', variant: 'destructive' });
      }
    }
  };

  const renderPoseStatus = (video: import('@/types').Video) => {
    const state = getPoseProcessingState(video.id);

    if (state.status === 'ready') {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="mt-2 inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-400 hover:bg-emerald-500/25"
              onClick={(e) => e.stopPropagation()}
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {`Pose Ready (${getPoseProcessModelLabel(state.modelVariant)})`}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {POSE_PROCESS_MODEL_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={`process-${video.id}-${option.variant}`}
                onSelect={(e) => {
                  e.stopPropagation();
                  void handleProcessPose(video, option.variant);
                }}
              >
                {`Reprocess ${option.label}`}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    if (state.status === 'queued') {
      return (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-sky-500/15 px-2 py-1 text-[11px] font-semibold text-sky-300">
          <Loader2 className="h-3.5 w-3.5" />
          <span>{`Pose queued (${getPoseProcessModelLabel(state.modelVariant)})`}</span>
          <button
            className="inline-flex items-center gap-1 rounded border border-sky-300/40 px-1.5 py-0.5 text-[10px] hover:bg-sky-400/15"
            onClick={(e) => {
              e.stopPropagation();
              cancelPoseProcessing(video.id);
            }}
            title="Cancel queued pose processing"
          >
            <Square className="h-3 w-3 fill-current" />
            Cancel
          </button>
        </div>
      );
    }

    if (state.status === 'processing') {
      return (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-500/15 px-2 py-1 text-[11px] font-semibold text-amber-300">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>{`Pose ${Math.round(state.progress * 100)}% (${getPoseProcessModelLabel(state.modelVariant)})${state.etaSec !== null ? ` · ${Math.max(0, Math.ceil(state.etaSec))}s` : ''}`}</span>
          <button
            className="inline-flex items-center gap-1 rounded border border-amber-300/40 px-1.5 py-0.5 text-[10px] hover:bg-amber-400/15"
            onClick={(e) => {
              e.stopPropagation();
              cancelPoseProcessing(video.id);
            }}
            title="Cancel pose processing"
          >
            <Square className="h-3 w-3 fill-current" />
            Cancel
          </button>
        </div>
      );
    }

    if (state.status === 'error') {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="mt-2 inline-flex items-center gap-1 rounded-md bg-destructive/20 px-2 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive/30"
              onClick={(e) => e.stopPropagation()}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              Retry Pose
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {POSE_PROCESS_MODEL_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={`retry-${video.id}-${option.variant}`}
                onSelect={(e) => {
                  e.stopPropagation();
                  void handleProcessPose(video, option.variant);
                }}
              >
                {`Process ${option.label}`}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary/20 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-primary/30"
            onClick={(e) => e.stopPropagation()}
          >
            Process Pose
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {POSE_PROCESS_MODEL_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={`process-menu-${video.id}-${option.variant}`}
              onSelect={(e) => {
                e.stopPropagation();
                void handleProcessPose(video, option.variant);
              }}
            >
              {`Process ${option.label}`}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  return (
    <>
      <Sidebar mobileSide="bottom" className="bg-[hsl(var(--sidebar-background))]">
        <SidebarHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold font-headline text-sidebar-foreground">Library</h2>
            <SidebarTrigger />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="w-full text-foreground" onClick={() => fileInputRef.current?.click()}>
              <FilePlus className="mr-2" /> Import
            </Button>
            <input type="file" ref={fileInputRef} onChange={handleFileImport} accept="video/*" className="hidden" />
            <VideoRecorder />
          </div>
        </SidebarHeader>
        <Separator />
        <SidebarContent>
          <ScrollArea className="h-full">
            {library.length > 0 ? (
              <SidebarMenu>
                {[...library].sort((a, b) => {
                  // Favorites first, then by date
                  if (a.isFavorite && !b.isFavorite) return -1;
                  if (!a.isFavorite && b.isFavorite) return 1;
                  return 0;
                }).map((video) => (
                  <SidebarMenuItem key={video.id}>
                    <div
                      className="group/menu-item relative flex flex-col items-start p-2 rounded-md hover:bg-sidebar-accent w-full text-left cursor-pointer transition-colors"
                      onClick={() => { void handleAddToGrid(video); }}
                    >
                      {/* Thumbnail Container */}
                      <div className="w-full aspect-video bg-black/10 rounded-md mb-2 overflow-hidden border border-border/20 relative shadow-sm">
                        {/* Favorite badge — always visible when favorited */}
                        {video.isFavorite && (
                          <div className="absolute top-1 left-1 z-10 pointer-events-none">
                            <Star className="h-4 w-4 text-yellow-400 fill-current drop-shadow-md" />
                          </div>
                        )}
                        {video.thumbnail ? (
                          <img src={video.thumbnail} alt={video.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="flex items-center justify-center h-full w-full bg-secondary/50">
                            <Video className="w-8 h-8 text-muted-foreground/50" />
                          </div>
                        )}
                        {/* Hover Overlay */}
                        <div className="absolute inset-0 bg-black/0 group-hover/menu-item:bg-black/10 transition-colors pointer-events-none" />

                        {/* Quick Actions Overlay (Visible on Hover) */}
                        <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover/menu-item:opacity-100 transition-opacity bg-black/60 rounded-md p-1 backdrop-blur-sm shadow-md pointer-events-auto">
                          <Button
                            size="icon"
                            variant="ghost"
                            className={`h-6 w-6 hover:bg-white/20 ${video.isFavorite
                                ? 'text-yellow-400 hover:text-yellow-300 opacity-100'
                                : 'text-white hover:text-yellow-400'
                              }`}
                            onClick={(e) => { e.stopPropagation(); void toggleFavorite(video.id); }}
                            title={video.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                          >
                            <Star className={`h-4 w-4 ${video.isFavorite ? 'fill-current' : ''}`} />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-white hover:text-white hover:bg-white/20"
                            onClick={(e) => { e.stopPropagation(); void handleAddToGrid(video); }}
                            title="Add to Grid"
                          >
                            <PlusCircle className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-red-400 hover:text-red-300 hover:bg-white/20"
                            onClick={(e) => { e.stopPropagation(); void removeVideoFromLibrary(video.id); }}
                            title="Delete Video"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="w-full min-w-0">
                        <p className="font-medium text-sm truncate text-sidebar-foreground" title={video.name}>{video.name}</p>
                        <p className="text-xs text-sidebar-foreground/70 flex items-center gap-1 mt-0.5">
                          {Math.round(video.duration)}s
                          <span className="w-0.5 h-0.5 rounded-full bg-current opacity-50" />
                          {new Date(video.createdAt).toLocaleDateString()}
                        </p>
                        {video.trimStart !== undefined && (
                          <p className="text-[10px] text-primary dark:text-accent font-semibold mt-1 uppercase tracking-wider opacity-90">
                            Trimmed
                          </p>
                        )}
                        {renderPoseStatus(video)}
                      </div>
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            ) : (
              <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                <Video className="w-16 h-16 text-muted-foreground/50 mb-4" />
                <h3 className="font-bold text-sidebar-foreground">Your Library is Empty</h3>
                <p className="text-sm text-muted-foreground">Import or record a video to get started.</p>
              </div>
            )}
          </ScrollArea>
        </SidebarContent>
        <SidebarFooter>
          <Card className="bg-transparent border-dashed">
            <CardHeader>
              <CardTitle className="text-base text-sidebar-foreground">Pro Tip</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">Use Cmd/Ctrl + B to toggle the library sidebar.</CardDescription>
            </CardHeader>
          </Card>
        </SidebarFooter>
      </Sidebar>

      <TrimDialog
        open={isTrimOpen}
        onOpenChange={handleDialogClose}
        blob={pendingFile}
        initialName={pendingFile ? `${pendingFile.name.replace(/\.[^/.]+$/, "")} - Segment ${nextSegmentIndex}` : "New Video"}
        onSave={handleSaveTrimmed}
      />
    </>
  );
}
