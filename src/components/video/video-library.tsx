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
import { FilePlus, Trash2, PlusCircle, Video } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { VideoRecorder } from './video-recorder';
import { Separator } from '../ui/separator';
import { TrimDialog } from './trim-dialog';

export function VideoLibrary() {
  const { library, addVideoToLibrary, removeVideoFromLibrary, setSlot, slots } = useAppContext();
  const fileInputRef = useRef<HTMLInputElement>(null);
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
    if(fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSaveTrimmed = async (name: string, trimStart: number, trimEnd: number) => {
    if (!pendingFile) return;
    
    // Helper to get duration and generate a thumbnail
    const processVideo = (file: File): Promise<{duration: number, thumbnail: string}> => {
        return new Promise((resolve) => {
            const v = document.createElement('video');
            v.preload = 'metadata';
            v.muted = true;
            v.playsInline = true;
            
            // Wait for metadata to be ready
            v.onloadedmetadata = () => {
                // Seek to the start frame of the trim
                // Note: Seeking might need a moment to buffer the frame
                v.currentTime = trimStart; 
            };
            
            // Once seeking is done, we can capture the frame
            v.onseeked = () => {
                const duration = v.duration;
                
                // Generate thumbnail
                const canvas = document.createElement('canvas');
                // Use a reasonable size for the library thumbnail (e.g., 320px width)
                // Maintain aspect ratio
                const scale = 320 / v.videoWidth;
                canvas.width = 320;
                canvas.height = v.videoHeight * scale;
                
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
                    const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
                    
                    resolve({ duration, thumbnail });
                } else {
                    resolve({ duration, thumbnail: '' }); // Fallback
                }
                // Cleanup
                // URL.revokeObjectURL(v.src); // Do this after resolving?
            };
            
            // Error handling
            v.onerror = () => {
                resolve({ duration: 0, thumbnail: '' });
            };
            
            v.src = URL.createObjectURL(file);
        });
    };

    const { duration, thumbnail } = await processVideo(pendingFile);

    await addVideoToLibrary({
        name: name,
        blob: pendingFile,
        duration: duration,
        trimStart,
        trimEnd,
        thumbnail, // Save the generated thumbnail
    });
    
    toast({ title: "Segment Saved", description: `${name} has been added to your library.` });

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

  const handleAddToGrid = (video: import('@/types').Video) => {
    const emptySlotIndex = slots.findIndex(slot => slot === null);
    if (emptySlotIndex !== -1) {
      setSlot(emptySlotIndex, video);
      toast({ title: 'Video Added', description: `"${video.name}" added to the grid.` });
    } else {
      toast({ title: 'Grid Full', description: 'All video slots are currently full.', variant: 'destructive' });
    }
  };

  return (
    <>
      <Sidebar className="bg-[hsl(var(--sidebar-background))]">
        <SidebarHeader>
            <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold font-headline text-sidebar-foreground">Library</h2>
            <SidebarTrigger />
            </div>
            <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="w-full text-foreground" onClick={() => fileInputRef.current?.click()}>
                <FilePlus className="mr-2"/> Import
                </Button>
                <input type="file" ref={fileInputRef} onChange={handleFileImport} accept="video/*" className="hidden" />
                <VideoRecorder />
            </div>
        </SidebarHeader>
        <Separator/>
        <SidebarContent>
            <ScrollArea className="h-full">
                {library.length > 0 ? (
                <SidebarMenu>
                    {library.map((video) => (
                    <SidebarMenuItem key={video.id}>
                        <div 
                          className="group/menu-item relative flex flex-col items-start p-2 rounded-md hover:bg-sidebar-accent w-full text-left cursor-pointer transition-colors"
                          onClick={() => handleAddToGrid(video)}
                        >
                            {/* Thumbnail Container */}
                            <div className="w-full aspect-video bg-black/10 rounded-md mb-2 overflow-hidden border border-border/20 relative shadow-sm">
                                {video.thumbnail ? (
                                    <img src={video.thumbnail} alt={video.name} className="w-full h-full object-cover" />
                                ) : (
                                    <div className="flex items-center justify-center h-full w-full bg-secondary/50">
                                        <Video className="w-8 h-8 text-muted-foreground/50"/>
                                    </div>
                                )}
                                {/* Hover Overlay */}
                                <div className="absolute inset-0 bg-black/0 group-hover/menu-item:bg-black/10 transition-colors pointer-events-none" />
                                
                                {/* Quick Actions Overlay (Visible on Hover) */}
                                <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover/menu-item:opacity-100 transition-opacity bg-black/60 rounded-md p-1 backdrop-blur-sm shadow-md pointer-events-auto">
                                    <Button 
                                      size="icon" 
                                      variant="ghost" 
                                      className="h-6 w-6 text-white hover:text-white hover:bg-white/20" 
                                      onClick={(e) => { e.stopPropagation(); handleAddToGrid(video); }} 
                                      title="Add to Grid"
                                    >
                                        <PlusCircle className="h-4 w-4" />
                                    </Button>
                                    <Button 
                                      size="icon" 
                                      variant="ghost" 
                                      className="h-6 w-6 text-red-400 hover:text-red-300 hover:bg-white/20" 
                                      onClick={(e) => { e.stopPropagation(); removeVideoFromLibrary(video.id); }} 
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
                            </div>
                        </div>
                    </SidebarMenuItem>
                    ))}
                </SidebarMenu>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                        <Video className="w-16 h-16 text-muted-foreground/50 mb-4"/>
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
