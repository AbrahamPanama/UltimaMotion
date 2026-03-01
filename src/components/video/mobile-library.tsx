'use client';
import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { useAppContext } from '@/contexts/app-context';
import { getPoseProcessModelLabel, POSE_PROCESS_MODEL_OPTIONS } from '@/lib/pose/pose-model-label';
import { FilePlus, Trash2, PlusCircle, Video, ChevronUp, ChevronDown, Loader2, CheckCircle2, AlertTriangle, Square } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { VideoRecorder } from './video-recorder';
import { TrimDialog } from './trim-dialog';
import { extractThumbnail } from '@/lib/video-utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { PoseModelVariant } from '@/types';

export function MobileLibrary() {
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
  } = useAppContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastAddActionRef = useRef<{ videoId: string; atMs: number } | null>(null);

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

    const { duration, thumbnail } = await extractThumbnail(pendingFile, trimStart);

    await addVideoToLibrary({
      name,
      blob: pendingFile,
      duration,
      trimStart,
      trimEnd,
      thumbnail,
    });

    toast({ title: 'Segment Saved' });
    setNextSegmentIndex((prev) => prev + 1);
  };

  const handleDialogClose = (open: boolean) => {
    setIsTrimOpen(open);
    if (!open) {
      setTimeout(() => setPendingFile(null), 300);
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
        toast({ title: 'Pose not ready', description: 'Process this clip before loading it.', variant: 'destructive' });
        return;
      }
      setPoseModelVariant(poseState.modelVariant);
    }

    const existingSlotIndex = slots.findIndex((slot) => slot?.id === video.id);
    if (existingSlotIndex !== -1) {
      setSlot(existingSlotIndex, video);
      toast({ title: 'Video already in grid' });
      return;
    }

    const emptySlotIndex = slots.findIndex((slot) => slot === null);
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
              className="mt-1 inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300"
              onClick={(e) => e.stopPropagation()}
            >
              <CheckCircle2 className="h-3 w-3" />
              {`Ready (${getPoseProcessModelLabel(state.modelVariant)})`}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {POSE_PROCESS_MODEL_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={`m-reprocess-${video.id}-${option.variant}`}
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
        <div className="mt-1 inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-sky-200">
          <Loader2 className="h-3 w-3" />
          <span>{`Queued (${getPoseProcessModelLabel(state.modelVariant)})`}</span>
          <button
            className="inline-flex items-center gap-0.5 rounded border border-sky-200/40 px-1 py-[1px] text-[8px] hover:bg-sky-300/15"
            onClick={(e) => {
              e.stopPropagation();
              cancelPoseProcessing(video.id);
            }}
            title="Cancel queued pose processing"
          >
            <Square className="h-2.5 w-2.5 fill-current" />
            Stop
          </button>
        </div>
      );
    }

    if (state.status === 'processing') {
      return (
        <div className="mt-1 inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-200">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>{`${Math.round(state.progress * 100)}% (${getPoseProcessModelLabel(state.modelVariant)})`}</span>
          <button
            className="inline-flex items-center gap-0.5 rounded border border-amber-200/40 px-1 py-[1px] text-[8px] hover:bg-amber-300/15"
            onClick={(e) => {
              e.stopPropagation();
              cancelPoseProcessing(video.id);
            }}
            title="Cancel pose processing"
          >
            <Square className="h-2.5 w-2.5 fill-current" />
            Stop
          </button>
        </div>
      );
    }

    if (state.status === 'error') {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="mt-1 inline-flex items-center gap-1 rounded bg-destructive/20 px-1.5 py-0.5 text-[9px] font-semibold text-destructive"
              onClick={(e) => e.stopPropagation()}
            >
              <AlertTriangle className="h-3 w-3" />
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
                key={`m-retry-${video.id}-${option.variant}`}
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
            className="mt-1 inline-flex items-center rounded bg-primary/20 px-1.5 py-0.5 text-[9px] font-semibold text-primary"
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
              key={`m-process-${video.id}-${option.variant}`}
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
      <div className="bg-card border-t border-border flex-shrink-0 pb-[env(safe-area-inset-bottom)]">
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
                  className="group relative flex-shrink-0 w-[156px] snap-start cursor-pointer"
                  onClick={() => { void handleAddToGrid(video); }}
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
                    <div className="absolute top-0.5 right-0.5 flex gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 bg-black/60 text-white hover:text-white hover:bg-black/80 rounded"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleAddToGrid(video);
                        }}
                        title="Add to Grid"
                      >
                        <PlusCircle className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 bg-black/60 text-red-400 hover:text-red-300 hover:bg-black/80 rounded"
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeVideoFromLibrary(video.id);
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
                  <div className="px-0.5">
                    {renderPoseStatus(video)}
                  </div>
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
