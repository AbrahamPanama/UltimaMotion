'use client';
import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Video as VideoIcon, Mic, XCircle } from 'lucide-react';
import { useAppContext } from '@/contexts/app-context';
import { TrimDialog } from './trim-dialog';

export function VideoRecorder() {
  const { addVideoToLibrary } = useAppContext();
  const [isOpen, setIsOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const { toast } = useToast();

  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [showTrimDialog, setShowTrimDialog] = useState(false);

  const startRecording = useCallback(async () => {
    setError(null);
    recordedChunksRef.current = [];
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60, max: 60 } },
        audio: true,
      });

      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.controls = false;
        videoPreviewRef.current.src = "";
      }

      mediaRecorderRef.current = new MediaRecorder(stream, { mimeType: 'video/webm' });

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        setRecordedBlob(blob);
        setShowTrimDialog(true);
        setIsOpen(false);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Error accessing media devices.', err);
      setError('Could not access camera/microphone. Please check permissions.');
      toast({ title: 'Error', description: 'Could not access camera/microphone.', variant: 'destructive' });
    }
  }, [toast]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      const stream = videoPreviewRef.current?.srcObject as MediaStream;
      stream?.getTracks().forEach(track => track.stop());
    }
  }, [isRecording]);

  const handleSaveTrimmed = async (name: string, trimStart: number, trimEnd: number) => {
    if (!recordedBlob) return;

    const getDuration = (blob: Blob): Promise<number> => {
      return new Promise((resolve) => {
        const tempVideo = document.createElement('video');
        tempVideo.preload = 'metadata';
        tempVideo.onloadedmetadata = () => {
          resolve(tempVideo.duration);
          URL.revokeObjectURL(tempVideo.src);
        };
        tempVideo.src = URL.createObjectURL(blob);
      });
    };

    const duration = await getDuration(recordedBlob);

    await addVideoToLibrary({
      name: name,
      blob: recordedBlob,
      duration: duration,
      trimStart,
      trimEnd,
    });
    setRecordedBlob(null);
    recordedChunksRef.current = [];
  };

  const handleCloseRecorder = () => {
    if (isRecording) {
      stopRecording();
    }
    setIsOpen(false);
    setIsRecording(false);
    setError(null);
    if (videoPreviewRef.current) {
      const stream = videoPreviewRef.current.srcObject as MediaStream;
      stream?.getTracks().forEach(track => track.stop());
      videoPreviewRef.current.srcObject = null;
      videoPreviewRef.current.src = '';
    }
    recordedChunksRef.current = [];
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleCloseRecorder()}>
        <Button onClick={() => setIsOpen(true)} variant="outline" className="w-full">
          <VideoIcon className="mr-2" />
          Rec. Video
        </Button>
        <DialogContent className="sm:max-w-[800px] bg-card">
          <DialogHeader>
            <DialogTitle>Video Recorder</DialogTitle>
            <DialogDescription>
              Record a new video clip. Aiming for 720p at 60fps.
            </DialogDescription>
          </DialogHeader>

          <div className="aspect-video w-full bg-muted rounded-md overflow-hidden">
            <video ref={videoPreviewRef} playsInline autoPlay muted className="w-full h-full object-cover"></video>
          </div>

          {error && (
            <div className="text-destructive text-sm flex items-center gap-2"><XCircle /> {error}</div>
          )}

          <DialogFooter className="sm:justify-between items-center">
            <p className="text-xs text-muted-foreground text-left">
              Actual recording settings may vary based on device and browser.
            </p>
            <div className="flex gap-2">
              <Button onClick={isRecording ? stopRecording : startRecording} className="w-[140px]">
                {isRecording ? (
                  <>
                    <Mic className="mr-2 animate-pulse" />
                    Stop Recording
                  </>
                ) : (
                  <>
                    <VideoIcon className="mr-2" />
                    Start Recording
                  </>
                )}
              </Button>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TrimDialog
        open={showTrimDialog}
        onOpenChange={setShowTrimDialog}
        blob={recordedBlob}
        initialName="Recorded Video"
        onSave={handleSaveTrimmed}
      />
    </>
  );
}
