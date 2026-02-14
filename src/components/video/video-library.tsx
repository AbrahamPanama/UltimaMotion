'use client';
import { useState, useRef } from 'react';
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

  const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('video/')) {
        toast({ title: 'Error', description: 'Please select a valid video file.', variant: 'destructive' });
        return;
      }
      // Instead of saving immediately, open the Trim Dialog
      setPendingFile(file);
      setIsTrimOpen(true);
    }
    // Reset input
    if(fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSaveTrimmed = async (name: string, trimStart: number, trimEnd: number) => {
    if (!pendingFile) return;
    
    const getDuration = (file: File): Promise<number> => {
        return new Promise((resolve) => {
            const v = document.createElement('video');
            v.preload = 'metadata';
            v.onloadedmetadata = () => {
                resolve(v.duration);
                URL.revokeObjectURL(v.src);
            };
            v.src = URL.createObjectURL(file);
        });
    };

    const duration = await getDuration(pendingFile);

    await addVideoToLibrary({
        name: name,
        blob: pendingFile,
        duration: duration,
        trimStart,
        trimEnd,
    });
    
    setPendingFile(null);
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
      <Sidebar>
        <SidebarHeader>
            <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold font-headline">Library</h2>
            <SidebarTrigger />
            </div>
            <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="w-full" onClick={() => fileInputRef.current?.click()}>
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
                        <div className="group/menu-item relative flex flex-col items-start p-2 rounded-md hover:bg-sidebar-accent w-full text-left">
                            <p className="font-medium text-sm truncate w-full" title={video.name}>{video.name}</p>
                            <p className="text-xs text-sidebar-foreground/70">
                                {new Date(video.createdAt).toLocaleDateString()} - {Math.round(video.duration)}s
                                {video.trimStart !== undefined ? <span className="ml-1 text-accent font-semibold">(Trimmed)</span> : ''}
                            </p>
                            <div className="absolute right-1 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover/menu-item:opacity-100 transition-opacity">
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => handleAddToGrid(video)}>
                                    <PlusCircle className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => removeVideoFromLibrary(video.id)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    </SidebarMenuItem>
                    ))}
                </SidebarMenu>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full p-4 text-center">
                        <Video className="w-16 h-16 text-muted-foreground/50 mb-4"/>
                        <h3 className="font-bold">Your Library is Empty</h3>
                        <p className="text-sm text-muted-foreground">Import or record a video to get started.</p>
                    </div>
                )}
            </ScrollArea>
        </SidebarContent>
        <SidebarFooter>
            <Card className="bg-transparent border-dashed">
                <CardHeader>
                    <CardTitle className="text-base">Pro Tip</CardTitle>
                    <CardDescription className="text-xs">Use Cmd/Ctrl + B to toggle the library sidebar.</CardDescription>
                </CardHeader>
            </Card>
        </SidebarFooter>
      </Sidebar>

      <TrimDialog 
        open={isTrimOpen} 
        onOpenChange={setIsTrimOpen}
        blob={pendingFile}
        initialName={pendingFile?.name || "New Video"}
        onSave={handleSaveTrimmed}
      />
    </>
  );
}
