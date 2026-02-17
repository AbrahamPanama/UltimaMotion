'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import type { Video, Drawing, DrawingType } from '@/types';
import { initDB, getAllVideos, addVideo as addVideoDB, deleteVideo as deleteVideoDB } from '@/lib/db';
import { useToast } from "@/hooks/use-toast";

const MAX_SLOTS = 4;

type Layout = 1 | 2 | 4;

interface AppContextType {
  library: Video[];
  loadLibrary: () => Promise<void>;
  addVideoToLibrary: (video: Omit<Video, 'id' | 'url' | 'createdAt'>) => Promise<void>;
  removeVideoFromLibrary: (id: string) => Promise<void>;

  slots: (Video | null)[];
  setSlot: (index: number, video: Video | null) => void;

  layout: Layout;
  setLayout: (layout: Layout) => void;

  isSyncEnabled: boolean;
  toggleSync: () => void;

  isPortraitMode: boolean;
  togglePortraitMode: () => void;

  isLoopEnabled: boolean;
  toggleLoop: () => void;

  syncOffsets: number[];
  updateSyncOffset: (index: number, delta: number) => void;

  isMuted: boolean;
  toggleMute: () => void;

  activeTileIndex: number | null;
  setActiveTileIndex: (index: number | null) => void;

  videoRefs: React.MutableRefObject<(HTMLVideoElement | null)[]>;

  zoomLevels: number[];
  setZoomLevel: (index: number, scale: number) => void;
  panPositions: { x: number, y: number }[];
  setPanPosition: (index: number, position: { x: number, y: number }) => void;

  // Drawing state
  isDrawingEnabled: boolean;
  toggleDrawing: () => void;
  drawingTool: DrawingType;
  setDrawingTool: (tool: DrawingType) => void;
  drawingColor: string;
  setDrawingColor: (color: string) => void;
  drawings: Record<string, Drawing[]>;
  setDrawingsForVideo: (videoId: string, newDrawings: Drawing[]) => void;
  clearDrawings: (videoId: string) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [library, setLibrary] = useState<Video[]>([]);
  const [slots, setSlots] = useState<(Video | null)[]>(Array(MAX_SLOTS).fill(null));
  const [layout, setLayout] = useState<Layout>(1);
  const [isSyncEnabled, setIsSyncEnabled] = useState<boolean>(false);
  const [isPortraitMode, setIsPortraitMode] = useState<boolean>(false);
  const [isLoopEnabled, setIsLoopEnabled] = useState<boolean>(true);
  const [syncOffsets, setSyncOffsets] = useState<number[]>(Array(MAX_SLOTS).fill(0));
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [activeTileIndex, setActiveTileIndex] = useState<number | null>(0);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const libraryRef = useRef<Video[]>([]);
  const { toast } = useToast();

  const [zoomLevels, setZoomLevels] = useState<number[]>(Array(MAX_SLOTS).fill(1));
  const [panPositions, setPanPositions] = useState<{ x: number, y: number }[]>(
    Array.from({ length: MAX_SLOTS }, () => ({ x: 0, y: 0 }))
  );

  // Drawing state
  const [isDrawingEnabled, setIsDrawingEnabled] = useState<boolean>(false);
  const [drawingTool, setDrawingTool] = useState<DrawingType>('free');
  const [drawingColor, setDrawingColor] = useState<string>('#ef4444'); // Default red
  const [drawings, setDrawings] = useState<Record<string, Drawing[]>>({});

  const loadLibrary = useCallback(async () => {
    try {
      await initDB();
      const videosFromDB = await getAllVideos();
      const videosWithUrls = videosFromDB.map(v => ({ ...v, url: URL.createObjectURL(v.blob) }));
      setLibrary(videosWithUrls);
    } catch (error) {
      console.error('Failed to load video library:', error);
      toast({ title: "Error", description: "Could not load video library.", variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  useEffect(() => {
    libraryRef.current = library;
  }, [library]);

  useEffect(() => {
    return () => {
      libraryRef.current.forEach((video) => URL.revokeObjectURL(video.url));
    };
  }, []);

  const addVideoToLibrary = async (videoData: Omit<Video, 'id' | 'url' | 'createdAt'>) => {
    try {
      // crypto.randomUUID() requires HTTPS on iOS Safari; fallback for HTTP dev
      const id = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : ([1e7].toString() + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
          (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16)
        );
      const newVideo: Video = {
        ...videoData,
        id,
        url: URL.createObjectURL(videoData.blob),
        createdAt: new Date(),
      };

      // Save to IndexedDB
      await addVideoDB(newVideo);

      // Update state
      setLibrary(prev => [...prev, newVideo]);
      // toast({ title: "Video Saved", description: `"${newVideo.name}" has been added to your library.` }); // Toast handled by caller for more context
    } catch (error) {
      console.error('Failed to add video:', error);
      toast({ title: "Error", description: "Could not save video.", variant: "destructive" });
    }
  };

  const removeVideoFromLibrary = async (id: string) => {
    try {
      await deleteVideoDB(id);
      setLibrary(prev => {
        const videoToRemove = prev.find(v => v.id === id);
        if (videoToRemove) URL.revokeObjectURL(videoToRemove.url);
        return prev.filter(v => v.id !== id);
      });
      setSlots(prevSlots => prevSlots.map(slot => (slot?.id === id ? null : slot)));
      toast({ title: "Video Removed" });
    } catch (error) {
      console.error('Failed to remove video:', error);
      toast({ title: "Error", description: "Failed to remove video.", variant: "destructive" });
    }
  };

  const setSlot = (index: number, video: Video | null) => {
    setSlots(prevSlots => {
      const newSlots = [...prevSlots];
      if (index >= 0 && index < MAX_SLOTS) {
        newSlots[index] = video;
      }

      // Auto-expand layout logic
      if (video !== null) {
        // Count how many slots will be filled after this update
        const filledCount = newSlots.filter(s => s !== null).length;

        // If we are adding a video, ensure layout is big enough
        // Current layout vs needed layout
        // 1 video -> layout 1
        // 2 videos -> layout 2
        // 3-4 videos -> layout 4

        let requiredLayout: Layout = 1;
        if (filledCount > 2) requiredLayout = 4;
        else if (filledCount > 1) requiredLayout = 2;

        // Only expand, don't shrink automatically
        if (requiredLayout > layout) {
          setLayout(requiredLayout);
        }
      }
      return newSlots;
    });

    // Reset sync offset when a new video is loaded into a slot
    setSyncOffsets(prev => {
      const newOffsets = [...prev];
      if (index >= 0 && index < MAX_SLOTS) {
        newOffsets[index] = 0;
      }
      return newOffsets;
    });

    // Reset zoom level
    setZoomLevels(prev => {
      const newLevels = [...prev];
      if (index >= 0 && index < MAX_SLOTS) {
        newLevels[index] = 1;
      }
      return newLevels;
    });

    // Reset pan position
    setPanPositions(prev => {
      const newPositions = [...prev];
      if (index >= 0 && index < MAX_SLOTS) {
        newPositions[index] = { x: 0, y: 0 };
      }
      return newPositions;
    });
  };

  const handleSetLayout = (newLayout: Layout) => {
    setLayout(newLayout);
    if (activeTileIndex !== null && activeTileIndex >= newLayout) {
      setActiveTileIndex(0);
    } else if (activeTileIndex === null) {
      setActiveTileIndex(0);
    }
  };

  const handleSetActiveTileIndex = (index: number | null) => {
    setActiveTileIndex(index);
  };

  const toggleSync = () => setIsSyncEnabled(prev => !prev);
  const togglePortraitMode = () => setIsPortraitMode(prev => !prev);
  const toggleLoop = () => setIsLoopEnabled(prev => !prev);
  const toggleMute = () => setIsMuted(prev => !prev);

  const toggleDrawing = () => setIsDrawingEnabled(prev => !prev);

  const updateSyncOffset = useCallback((index: number, delta: number) => {
    setSyncOffsets(prev => {
      const newOffsets = [...prev];
      newOffsets[index] = (newOffsets[index] || 0) + delta;
      return newOffsets;
    });
  }, []);

  const setZoomLevel = (index: number, scale: number) => {
    setZoomLevels(prev => {
      if (isSyncEnabled) {
        return prev.map(() => scale);
      }
      const newLevels = [...prev];
      newLevels[index] = scale;
      return newLevels;
    });
  };

  const setPanPosition = (index: number, position: { x: number, y: number }) => {
    setPanPositions(prev => {
      if (isSyncEnabled) {
        return prev.map(() => position);
      }
      const newPositions = [...prev];
      newPositions[index] = position;
      return newPositions;
    });
  };

  const setDrawingsForVideo = (videoId: string, newDrawings: Drawing[]) => {
    setDrawings(prev => ({
      ...prev,
      [videoId]: newDrawings
    }));
  };

  const clearDrawings = (videoId: string) => {
    setDrawings(prev => ({
      ...prev,
      [videoId]: []
    }));
  };

  const value = {
    library,
    loadLibrary,
    addVideoToLibrary,
    removeVideoFromLibrary,
    slots,
    setSlot,
    layout,
    setLayout: handleSetLayout,
    isSyncEnabled,
    toggleSync,
    isPortraitMode,
    togglePortraitMode,
    isLoopEnabled,
    toggleLoop,
    syncOffsets,
    updateSyncOffset,
    isMuted,
    toggleMute,
    activeTileIndex,
    setActiveTileIndex: handleSetActiveTileIndex,
    videoRefs,
    zoomLevels,
    setZoomLevel,
    panPositions,
    setPanPosition,

    // Drawing
    isDrawingEnabled,
    toggleDrawing,
    drawingTool,
    setDrawingTool,
    drawingColor,
    setDrawingColor,
    drawings,
    setDrawingsForVideo,
    clearDrawings
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
