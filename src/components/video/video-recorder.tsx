'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
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
import { Video as VideoIcon, Mic, XCircle, SwitchCamera } from 'lucide-react';
import { useAppContext } from '@/contexts/app-context';
import { TrimDialog } from './trim-dialog';
import { getSupportedMimeType, extractThumbnail } from '@/lib/video-utils';

export function VideoRecorder() {
  const { addVideoToLibrary } = useAppContext();
  const [isOpen, setIsOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { toast } = useToast();

  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [showTrimDialog, setShowTrimDialog] = useState(false);
  const [streamAspect, setStreamAspect] = useState<number>(16 / 9); // actual stream aspect ratio

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null;
    }
  }, []);

  const startPreview = useCallback(async (facing: 'environment' | 'user') => {
    stopStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: facing },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 60, max: 60 },
        },
        audio: true,
      });
      streamRef.current = stream;
      if (videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream;
        videoPreviewRef.current.controls = false;
        videoPreviewRef.current.src = "";

        // Detect actual stream dimensions once video loads
        videoPreviewRef.current.onloadedmetadata = () => {
          const vw = videoPreviewRef.current?.videoWidth || 16;
          const vh = videoPreviewRef.current?.videoHeight || 9;
          setStreamAspect(vw / vh);
        };
      }
      setError(null);
      return stream;
    } catch (err) {
      console.error('Error accessing media devices.', err);
      setError('Could not access camera/microphone. Please check permissions.');
      toast({ title: 'Error', description: 'Could not access camera/microphone.', variant: 'destructive' });
      return null;
    }
  }, [stopStream, toast]);

  const startRecording = useCallback(async () => {
    setError(null);
    recordedChunksRef.current = [];

    const stream = streamRef.current || await startPreview(facingMode);
    if (!stream) return;

    const mimeType = getSupportedMimeType();
    const recorderOptions: MediaRecorderOptions = mimeType ? { mimeType } : {};
    mediaRecorderRef.current = new MediaRecorder(stream, recorderOptions);

    mediaRecorderRef.current.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    mediaRecorderRef.current.onstop = () => {
      // Use the actual MIME type from the recorder (not hardcoded)
      const actualType = mediaRecorderRef.current?.mimeType || mimeType || 'video/mp4';
      const blob = new Blob(recordedChunksRef.current, { type: actualType });
      setRecordedBlob(blob);
      setShowTrimDialog(true);
      setIsOpen(false);
    };

    mediaRecorderRef.current.start();
    setIsRecording(true);
  }, [facingMode, startPreview]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      stopStream();
    }
  }, [isRecording, stopStream]);

  const toggleCamera = useCallback(async () => {
    if (isRecording) return;
    const newFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(newFacing);
    await startPreview(newFacing);
  }, [facingMode, isRecording, startPreview]);

  const handleOpen = useCallback(async () => {
    setIsOpen(true);
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
    }
    previewTimerRef.current = setTimeout(() => {
      startPreview(facingMode);
      previewTimerRef.current = null;
    }, 100);
  }, [facingMode, startPreview]);

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
      }
      stopStream();
    };
  }, [stopStream]);

  const handleSaveTrimmed = async (name: string, trimStart: number, trimEnd: number) => {
    if (!recordedBlob) return;

    // Use extractThumbnail to get both duration and a thumbnail frame (iOS-compatible)
    const { duration, thumbnail } = await extractThumbnail(recordedBlob, trimStart);

    await addVideoToLibrary({
      name: name,
      blob: recordedBlob,
      duration: duration,
      trimStart,
      trimEnd,
      thumbnail,
    });
    setRecordedBlob(null);
    recordedChunksRef.current = [];
  };

  const handleCloseRecorder = () => {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    if (isRecording) {
      stopRecording();
    }
    setIsOpen(false);
    setIsRecording(false);
    setError(null);
    stopStream();
    recordedChunksRef.current = [];
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && handleCloseRecorder()}>
        <Button onClick={handleOpen} variant="outline" className="w-full">
          <VideoIcon className="mr-2" />
          Rec. Video
        </Button>
        <DialogContent className="sm:max-w-[800px] bg-card">
          <DialogHeader>
            <DialogTitle>Video Recorder</DialogTitle>
            <DialogDescription>
              Record a new video clip. Using {facingMode === 'environment' ? 'back' : 'front'} camera.
            </DialogDescription>
          </DialogHeader>

          <div
            className="relative w-full bg-muted rounded-md overflow-hidden"
            style={{ aspectRatio: streamAspect, maxHeight: streamAspect < 1 ? '55vh' : undefined }}
          >
            <video ref={videoPreviewRef} playsInline autoPlay muted className="w-full h-full object-contain"></video>
            {/* Camera flip button */}
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-2 right-2 h-9 w-9 bg-black/50 hover:bg-black/70 text-white border-0 rounded-full backdrop-blur-sm"
              onClick={toggleCamera}
              disabled={isRecording}
              title={`Switch to ${facingMode === 'environment' ? 'front' : 'back'} camera`}
            >
              <SwitchCamera className="h-5 w-5" />
            </Button>
          </div>

          {error && (
            <div className="text-destructive text-sm flex items-center gap-2"><XCircle /> {error}</div>
          )}

          <DialogFooter className="sm:justify-between items-center">
            <p className="text-xs text-muted-foreground text-left">
              {facingMode === 'environment' ? '📷 Back camera' : '🤳 Front camera'} · Tap 🔄 to switch
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
