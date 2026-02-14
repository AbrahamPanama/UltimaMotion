'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import type { Video } from '@/types';
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
  const { toast } = useToast();

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

  const addVideoToLibrary = async (videoData: Omit<Video, 'id' | 'url' | 'createdAt'>) => {
    try {
      const newVideo: Video = {
        ...videoData,
        id: crypto.randomUUID(),
        url: URL.createObjectURL(videoData.blob),
        createdAt: new Date(),
      };
      await addVideoDB(newVideo);
      setLibrary(prev => [...prev, newVideo]);
      toast({ title: "Video Saved", description: `"${newVideo.name}" has been added to your library.` });
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
      toast({ title: "Video Removed", description: "The video has been deleted from your library." });
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
      // Auto-expand layout to show all filled slots
      if (video !== null) {
        const filledCount = newSlots.filter(s => s !== null).length;
        const newLayout = filledCount <= 1 ? 1 : filledCount <= 2 ? 2 : 4;
        if (newLayout > layout) {
          setLayout(newLayout as Layout);
        }
      }
      return newSlots;
    });
    // Reset sync offset when a new video is loaded into a slot
    setSyncOffsets(prev => {
      const newOffsets = [...prev];
      newOffsets[index] = 0;
      return newOffsets;
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

  const updateSyncOffset = useCallback((index: number, delta: number) => {
    setSyncOffsets(prev => {
      const newOffsets = [...prev];
      newOffsets[index] = (newOffsets[index] || 0) + delta;
      return newOffsets;
    });
  }, []);

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
