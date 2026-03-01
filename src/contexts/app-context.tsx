'use client';

import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import type { Video, Drawing, DrawingType, PoseModelVariant, PoseAnalyzeScope } from '@/types';
import { initDB, getAllVideos, addVideo as addVideoDB, deleteVideo as deleteVideoDB, toggleVideoFavorite as toggleFavDB } from '@/lib/db';
import {
  buildPoseAnalysisCacheId,
  loadPoseAnalysisCache,
  type PoseAnalysisCacheKey,
} from '@/lib/pose/pose-analysis-cache';
import { preprocessPoseVideoClip } from '@/lib/pose/pose-preprocess-job';
import type { PoseRuntimeConfig } from '@/lib/pose/pose-runtime';
import { useToast } from "@/hooks/use-toast";

const MAX_SLOTS = 4;

export const SYNC_DRAWINGS_KEY = '__sync_drawings__';

type Layout = 1 | 2 | 4;
type PoseProcessingStatus = 'idle' | 'queued' | 'processing' | 'ready' | 'error';
export type CompareViewMode = 'grid' | 'overlay';
export type OverlayBlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'difference'
  | 'lighten'
  | 'darken';
export type OverlayColorFilter = 'none' | 'warm' | 'cool' | 'vivid' | 'sepia';

const getRequiredLayoutForSlots = (slotList: (Video | null)[]): Layout => {
  const highestFilledIndex = slotList.reduce((highest, slot, index) => (slot ? index : highest), -1);
  if (highestFilledIndex >= 2) return 4;
  if (highestFilledIndex >= 1) return 2;
  return 1;
};

export interface PoseProcessingState {
  status: PoseProcessingStatus;
  progress: number;
  etaSec: number | null;
  error: string | null;
  modelVariant: PoseModelVariant | null;
  updatedAtMs: number;
}

const createIdlePoseProcessingState = (): PoseProcessingState => ({
  status: 'idle',
  progress: 0,
  etaSec: null,
  error: null,
  modelVariant: null,
  updatedAtMs: Date.now(),
});

interface AppContextType {
  library: Video[];
  loadLibrary: () => Promise<void>;
  addVideoToLibrary: (video: Omit<Video, 'id' | 'url' | 'createdAt'>) => Promise<void>;
  removeVideoFromLibrary: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  poseProcessingByVideo: Record<string, PoseProcessingState>;
  getPoseProcessingState: (videoId?: string | null) => PoseProcessingState;
  processPoseForVideo: (video: Video, modelVariant?: PoseModelVariant) => Promise<boolean>;
  cancelPoseProcessing: (videoId?: string | null) => void;
  cancelAllPoseProcessing: () => void;

  slots: (Video | null)[];
  setSlot: (index: number, video: Video | null) => void;

  layout: Layout;
  setLayout: (layout: Layout) => void;
  compareViewMode: CompareViewMode;
  setCompareViewMode: (mode: CompareViewMode) => void;
  canUseOverlayComparison: boolean;
  overlayOpacity: number;
  setOverlayOpacity: (value: number) => void;
  overlayBlendMode: OverlayBlendMode;
  setOverlayBlendMode: (mode: OverlayBlendMode) => void;
  overlayTopColorFilter: OverlayColorFilter;
  setOverlayTopColorFilter: (mode: OverlayColorFilter) => void;
  overlayTopBlackAndWhite: boolean;
  setOverlayTopBlackAndWhite: (enabled: boolean) => void;

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
  playbackRate: number;
  setPlaybackRate: (rate: number) => void;

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
  isSyncDrawingsEnabled: boolean;
  toggleSyncDrawings: () => void;

  // Pose overlay state
  isPoseEnabled: boolean;
  togglePose: () => void;
  poseModelVariant: PoseModelVariant;
  setPoseModelVariant: (variant: PoseModelVariant) => void;
  poseAnalyzeScope: PoseAnalyzeScope;
  setPoseAnalyzeScope: (scope: PoseAnalyzeScope) => void;
  poseMinVisibility: number;
  setPoseMinVisibility: (value: number) => void;
  poseTargetFps: number;
  setPoseTargetFps: (value: number) => void;
  poseMinPoseDetectionConfidence: number;
  setPoseMinPoseDetectionConfidence: (value: number) => void;
  poseMinPosePresenceConfidence: number;
  setPoseMinPosePresenceConfidence: (value: number) => void;
  poseMinTrackingConfidence: number;
  setPoseMinTrackingConfidence: (value: number) => void;
  poseUseExactFrameSync: boolean;
  setPoseUseExactFrameSync: (value: boolean) => void;
  poseUseSmoothing: boolean;
  setPoseUseSmoothing: (value: boolean) => void;
  poseUsePreprocessCache: boolean;
  setPoseUsePreprocessCache: (value: boolean) => void;
  poseUseYoloMultiPerson: boolean;
  setPoseUseYoloMultiPerson: (value: boolean) => void;
  poseShowCoG: boolean;
  setPoseShowCoG: (value: boolean) => void;
  poseShowCoGCharts: boolean;
  setPoseShowCoGCharts: (value: boolean) => void;
  poseShowJointAngles: boolean;
  setPoseShowJointAngles: (value: boolean) => void;
  poseShowBodyLean: boolean;
  setPoseShowBodyLean: (value: boolean) => void;
  poseShowJumpHeight: boolean;
  setPoseShowJumpHeight: (value: boolean) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [library, setLibrary] = useState<Video[]>([]);
  const [slots, setSlots] = useState<(Video | null)[]>(Array(MAX_SLOTS).fill(null));
  const [layout, setLayout] = useState<Layout>(1);
  const [compareViewMode, setCompareViewMode] = useState<CompareViewMode>('grid');
  const [overlayOpacity, setOverlayOpacityState] = useState<number>(0.5);
  const [overlayBlendMode, setOverlayBlendMode] = useState<OverlayBlendMode>('overlay');
  const [overlayTopColorFilter, setOverlayTopColorFilter] = useState<OverlayColorFilter>('none');
  const [overlayTopBlackAndWhite, setOverlayTopBlackAndWhite] = useState<boolean>(false);
  const [poseProcessingByVideo, setPoseProcessingByVideo] = useState<Record<string, PoseProcessingState>>({});
  const [isSyncEnabled, setIsSyncEnabled] = useState<boolean>(false);
  const [isPortraitMode, setIsPortraitMode] = useState<boolean>(false);
  const [isLoopEnabled, setIsLoopEnabled] = useState<boolean>(true);
  const [syncOffsets, setSyncOffsets] = useState<number[]>(Array(MAX_SLOTS).fill(0));
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [activeTileIndex, setActiveTileIndex] = useState<number | null>(0);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const poseProcessingPromisesRef = useRef<Record<string, Promise<boolean>>>({});
  const poseProcessingControllersRef = useRef<Record<string, AbortController>>({});
  const poseProcessingQueueRef = useRef<Promise<void>>(Promise.resolve());
  const removedVideoIdsRef = useRef<Set<string>>(new Set());
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
  const [isSyncDrawingsEnabled, setIsSyncDrawingsEnabled] = useState(false);

  // Pose overlay state
  const [isPoseEnabled, setIsPoseEnabled] = useState<boolean>(false);
  const [poseModelVariant, setPoseModelVariant] = useState<PoseModelVariant>('yolo26-xlarge');
  const [poseAnalyzeScope, setPoseAnalyzeScope] = useState<PoseAnalyzeScope>('all-visible');
  const [poseMinVisibility, setPoseMinVisibility] = useState<number>(0.25);
  const [poseTargetFps, setPoseTargetFps] = useState<number>(60);
  const [poseMinPoseDetectionConfidence, setPoseMinPoseDetectionConfidence] = useState<number>(0.55);
  const [poseMinPosePresenceConfidence, setPoseMinPosePresenceConfidence] = useState<number>(0.65);
  const [poseMinTrackingConfidence, setPoseMinTrackingConfidence] = useState<number>(0.65);
  const [poseUseExactFrameSync, setPoseUseExactFrameSync] = useState<boolean>(true);
  const [poseUseSmoothing, setPoseUseSmoothing] = useState<boolean>(false);
  const [poseUsePreprocessCache, setPoseUsePreprocessCache] = useState<boolean>(true);
  const [poseUseYoloMultiPerson, setPoseUseYoloMultiPerson] = useState<boolean>(true);
  const [poseShowCoG, setPoseShowCoG] = useState<boolean>(false);
  const [poseShowCoGCharts, setPoseShowCoGCharts] = useState<boolean>(true);
  const [poseShowJointAngles, setPoseShowJointAngles] = useState<boolean>(false);
  const [poseShowBodyLean, setPoseShowBodyLean] = useState<boolean>(false);
  const [poseShowJumpHeight, setPoseShowJumpHeight] = useState<boolean>(false);

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
      removedVideoIdsRef.current.delete(id);

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

  const toggleFavorite = async (id: string) => {
    try {
      const newValue = await toggleFavDB(id);
      setLibrary(prev =>
        prev.map(v => v.id === id ? { ...v, isFavorite: newValue } : v)
      );
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };

  const removeVideoFromLibrary = async (id: string) => {
    try {
      removedVideoIdsRef.current.add(id);
      const controller = poseProcessingControllersRef.current[id];
      controller?.abort();
      delete poseProcessingControllersRef.current[id];
      await deleteVideoDB(id);
      delete poseProcessingPromisesRef.current[id];
      setPoseProcessingByVideo(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setLibrary(prev => {
        const videoToRemove = prev.find(v => v.id === id);
        if (videoToRemove) URL.revokeObjectURL(videoToRemove.url);
        return prev.filter(v => v.id !== id);
      });
      setSlots(prevSlots => {
        const newSlots = prevSlots.map(slot => (slot?.id === id ? null : slot));
        const requiredLayout = getRequiredLayoutForSlots(newSlots);
        setLayout(requiredLayout);
        setActiveTileIndex(prev => (prev === null || prev >= requiredLayout ? 0 : prev));
        return newSlots;
      });
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
        // Enforce uniqueness: a single video id may only exist once in the grid.
        if (video?.id) {
          for (let i = 0; i < MAX_SLOTS; i += 1) {
            if (i !== index && newSlots[i]?.id === video.id) {
              newSlots[i] = null;
            }
          }
        }
        newSlots[index] = video;
      }
      const requiredLayout = getRequiredLayoutForSlots(newSlots);
      setLayout(requiredLayout);
      setActiveTileIndex(prev => (prev === null || prev >= requiredLayout ? 0 : prev));
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
  const togglePose = () => setIsPoseEnabled(prev => !prev);

  const clampUnit = (value: number) => Math.max(0, Math.min(1, value));
  const clampFps = (value: number) => Math.max(5, Math.min(60, Math.round(value)));

  const handleSetPoseMinVisibility = (value: number) => {
    setPoseMinVisibility(clampUnit(value));
  };

  const handleSetPoseTargetFps = (value: number) => {
    setPoseTargetFps(clampFps(value));
  };

  const handleSetPoseMinPoseDetectionConfidence = (value: number) => {
    setPoseMinPoseDetectionConfidence(clampUnit(value));
  };

  const handleSetPoseMinPosePresenceConfidence = (value: number) => {
    setPoseMinPosePresenceConfidence(clampUnit(value));
  };

  const handleSetPoseMinTrackingConfidence = (value: number) => {
    setPoseMinTrackingConfidence(clampUnit(value));
  };

  const updateSyncOffset = useCallback((index: number, delta: number) => {
    setSyncOffsets(prev => {
      const newOffsets = [...prev];
      const next = (newOffsets[index] || 0) + delta;
      newOffsets[index] = Number(next.toFixed(6));
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

  const toggleSyncDrawings = () => setIsSyncDrawingsEnabled(v => !v);
  const canUseOverlayComparison = slots.filter((slot) => slot !== null).length === 2;

  const handleSetOverlayOpacity = (value: number) => {
    setOverlayOpacityState(Math.max(0, Math.min(1, value)));
  };

  useEffect(() => {
    if (compareViewMode === 'overlay' && !canUseOverlayComparison) {
      setCompareViewMode('grid');
    }
  }, [canUseOverlayComparison, compareViewMode]);

  const buildPoseCacheKeyForVideo = useCallback((video: Video, modelVariant?: PoseModelVariant): PoseAnalysisCacheKey => {
    const trimStartSec = Number.isFinite(video.trimStart) ? Math.max(0, video.trimStart ?? 0) : 0;
    const trimEndCandidate = Number.isFinite(video.trimEnd) ? video.trimEnd ?? trimStartSec : video.duration;
    const trimEndSec = Math.max(
      trimStartSec,
      Number.isFinite(trimEndCandidate) ? trimEndCandidate : trimStartSec
    );
    return {
      videoId: video.id,
      modelVariant: modelVariant ?? poseModelVariant,
      targetFps: poseTargetFps,
      yoloMultiPerson: poseUseYoloMultiPerson,
      trimStartMs: Math.max(0, Math.floor(trimStartSec * 1000)),
      trimEndMs: Math.max(0, Math.floor(trimEndSec * 1000)),
    };
  }, [poseModelVariant, poseTargetFps, poseUseYoloMultiPerson]);

  const enqueuePoseProcessingJob = useCallback(function <T>(job: () => Promise<T>): Promise<T> {
    const queuedJob = poseProcessingQueueRef.current.then(job, job);
    poseProcessingQueueRef.current = queuedJob.then(() => undefined, () => undefined);
    return queuedJob;
  }, []);

  const setPoseProcessingStateForVideo = useCallback(
    (videoId: string, state: PoseProcessingState | null) => {
      setPoseProcessingByVideo(prev => {
        if (removedVideoIdsRef.current.has(videoId) && state !== null) {
          return prev;
        }
        const next = { ...prev };
        if (state === null) {
          delete next[videoId];
          return next;
        }
        next[videoId] = state;
        return next;
      });
    },
    []
  );

  const cancelPoseProcessing = useCallback((videoId?: string | null) => {
    if (!videoId) return;
    const controller = poseProcessingControllersRef.current[videoId];
    if (!controller) return;
    controller.abort();
    delete poseProcessingPromisesRef.current[videoId];
    setPoseProcessingByVideo(prev => {
      const current = prev[videoId];
      if (!current || (current.status !== 'processing' && current.status !== 'queued')) return prev;
      return {
        ...prev,
        [videoId]: {
          ...current,
          status: 'idle',
          progress: 0,
          etaSec: null,
          error: null,
          updatedAtMs: Date.now(),
        },
      };
    });
  }, []);

  const cancelAllPoseProcessing = useCallback(() => {
    const controllers = Object.values(poseProcessingControllersRef.current);
    controllers.forEach((controller) => controller.abort());
    poseProcessingPromisesRef.current = {};
    setPoseProcessingByVideo(prev => {
      const next = { ...prev };
      for (const [videoId, state] of Object.entries(next)) {
        if (state.status !== 'processing' && state.status !== 'queued') continue;
        next[videoId] = {
          ...state,
          status: 'idle',
          progress: 0,
          etaSec: null,
          error: null,
          updatedAtMs: Date.now(),
        };
      }
      return next;
    });
  }, []);

  const getPoseProcessingState = useCallback(
    (videoId?: string | null): PoseProcessingState => {
      if (!videoId) return createIdlePoseProcessingState();
      return poseProcessingByVideo[videoId] ?? createIdlePoseProcessingState();
    },
    [poseProcessingByVideo]
  );

  const processPoseForVideo = useCallback(async (video: Video, modelVariant?: PoseModelVariant) => {
    if (!video?.id) return false;
    removedVideoIdsRef.current.delete(video.id);
    const modelToProcess = modelVariant ?? poseModelVariant;

    const existingPromise = poseProcessingPromisesRef.current[video.id];
    if (existingPromise) {
      return existingPromise;
    }

    const abortController = new AbortController();
    poseProcessingControllersRef.current[video.id] = abortController;

    const buildReadyState = (variant: PoseModelVariant | null): PoseProcessingState => ({
      status: 'ready',
      progress: 1,
      etaSec: 0,
      error: null,
      modelVariant: variant,
      updatedAtMs: Date.now(),
    });
    const buildProcessingState = (progress: number, etaSec: number | null): PoseProcessingState => ({
      status: 'processing',
      progress,
      etaSec,
      error: null,
      modelVariant: modelToProcess,
      updatedAtMs: Date.now(),
    });
    const buildIdleState = (): PoseProcessingState => ({
      status: 'idle',
      progress: 0,
      etaSec: null,
      error: null,
      modelVariant: null,
      updatedAtMs: Date.now(),
    });
    const buildQueuedState = (): PoseProcessingState => ({
      status: 'queued',
      progress: 0,
      etaSec: null,
      error: null,
      modelVariant: modelToProcess,
      updatedAtMs: Date.now(),
    });
    const restorePoseStateAfterAbort = async (): Promise<PoseProcessingState> => {
      const cacheKey = buildPoseCacheKeyForVideo(video, modelToProcess);
      const cacheId = buildPoseAnalysisCacheId(cacheKey);
      const cached = await loadPoseAnalysisCache(cacheId);
      if (cached && cached.frames.length > 0) {
        return buildReadyState((cached.modelVariant ?? modelToProcess) as PoseModelVariant);
      }
      return buildIdleState();
    };

    setPoseProcessingStateForVideo(video.id, buildQueuedState());

    const processPromise = enqueuePoseProcessingJob(async () => {
      const cacheKey = buildPoseCacheKeyForVideo(video, modelToProcess);
      const cacheId = buildPoseAnalysisCacheId(cacheKey);

      if (abortController.signal.aborted) {
        const restored = await restorePoseStateAfterAbort();
        setPoseProcessingStateForVideo(video.id, restored);
        return false;
      }

      setPoseProcessingStateForVideo(video.id, buildProcessingState(0, null));

      try {
        const cached = await loadPoseAnalysisCache(cacheId);
        if (
          cached &&
          cached.frames.length > 0 &&
          cached.modelVariant === modelToProcess
        ) {
          setPoseProcessingStateForVideo(video.id, buildReadyState(modelToProcess));
          return true;
        }

        const runtimeConfig: PoseRuntimeConfig = {
          modelVariant: modelToProcess,
          numPoses: 4,
          yoloMultiPerson: poseUseYoloMultiPerson,
          minPoseDetectionConfidence: poseMinPoseDetectionConfidence,
          minPosePresenceConfidence: poseMinPosePresenceConfidence,
          minTrackingConfidence: poseMinTrackingConfidence,
        };

        await preprocessPoseVideoClip({
          video,
          cacheKey,
          runtimeConfig,
          targetFps: poseTargetFps,
          signal: abortController.signal,
          onProgress: (progress, etaSec) => {
            if (abortController.signal.aborted) return;
            setPoseProcessingStateForVideo(video.id, buildProcessingState(progress, etaSec));
          },
        });

        if (abortController.signal.aborted) {
          const restored = await restorePoseStateAfterAbort();
          setPoseProcessingStateForVideo(video.id, restored);
          return false;
        }

        setPoseProcessingStateForVideo(video.id, buildReadyState(modelToProcess));
        return true;
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          const restored = await restorePoseStateAfterAbort();
          setPoseProcessingStateForVideo(video.id, restored);
          return false;
        }
        const message = error instanceof Error ? error.message : 'Pose preprocessing failed.';
        setPoseProcessingStateForVideo(video.id, {
          status: 'error',
          progress: 0,
          etaSec: null,
          error: message,
          modelVariant: modelToProcess,
          updatedAtMs: Date.now(),
        });
        return false;
      } finally {
        if (poseProcessingPromisesRef.current[video.id] === processPromise) {
          delete poseProcessingPromisesRef.current[video.id];
        }
        delete poseProcessingControllersRef.current[video.id];
      }
    });

    poseProcessingPromisesRef.current[video.id] = processPromise;
    return processPromise;
  }, [
    buildPoseCacheKeyForVideo,
    enqueuePoseProcessingJob,
    poseMinPoseDetectionConfidence,
    poseMinPosePresenceConfidence,
    poseMinTrackingConfidence,
    poseModelVariant,
    poseTargetFps,
    poseUseYoloMultiPerson,
    setPoseProcessingStateForVideo,
  ]);

  useEffect(() => {
    const handlePageTeardown = () => {
      cancelAllPoseProcessing();
    };
    window.addEventListener('beforeunload', handlePageTeardown);
    window.addEventListener('pagehide', handlePageTeardown);
    return () => {
      window.removeEventListener('beforeunload', handlePageTeardown);
      window.removeEventListener('pagehide', handlePageTeardown);
      cancelAllPoseProcessing();
    };
  }, [cancelAllPoseProcessing]);

  useEffect(() => {
    let cancelled = false;

    const refreshPoseCacheStates = async () => {
      const videos = library;
      const existingReady = await Promise.all(videos.map(async (video) => {
        const cacheKey = buildPoseCacheKeyForVideo(video);
        const cacheId = buildPoseAnalysisCacheId(cacheKey);
        const cached = await loadPoseAnalysisCache(cacheId);
        return {
          videoId: video.id,
          ready: Boolean(cached && cached.frames.length > 0),
          modelVariant: (cached?.modelVariant ?? null) as PoseModelVariant | null,
        };
      }));

      if (cancelled) return;

      const videoIds = new Set(videos.map((video) => video.id));

      setPoseProcessingByVideo(prev => {
        const next: Record<string, PoseProcessingState> = {};
        for (const { videoId, ready, modelVariant } of existingReady) {
          const previous = prev[videoId];
          if (previous?.status === 'processing' || previous?.status === 'queued') {
            next[videoId] = previous;
            continue;
          }
          if (ready) {
            next[videoId] = {
              status: 'ready',
              progress: 1,
              etaSec: 0,
              error: null,
              modelVariant,
              updatedAtMs: Date.now(),
            };
            continue;
          }
          if (previous?.status === 'error') {
            next[videoId] = previous;
            continue;
          }
          next[videoId] = createIdlePoseProcessingState();
        }

        for (const key of Object.keys(prev)) {
          if (!videoIds.has(key) && (prev[key]?.status === 'processing' || prev[key]?.status === 'queued')) {
            next[key] = prev[key];
          }
        }

        return next;
      });
    };

    void refreshPoseCacheStates();

    return () => {
      cancelled = true;
    };
  }, [buildPoseCacheKeyForVideo, library]);

  const value = {
    library,
    loadLibrary,
    addVideoToLibrary,
    removeVideoFromLibrary,
    toggleFavorite,
    poseProcessingByVideo,
    getPoseProcessingState,
    processPoseForVideo,
    cancelPoseProcessing,
    cancelAllPoseProcessing,
    slots,
    setSlot,
    layout,
    setLayout: handleSetLayout,
    compareViewMode,
    setCompareViewMode,
    canUseOverlayComparison,
    overlayOpacity,
    setOverlayOpacity: handleSetOverlayOpacity,
    overlayBlendMode,
    setOverlayBlendMode,
    overlayTopColorFilter,
    setOverlayTopColorFilter,
    overlayTopBlackAndWhite,
    setOverlayTopBlackAndWhite,
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
    playbackRate,
    setPlaybackRate,
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
    clearDrawings,
    isSyncDrawingsEnabled,
    toggleSyncDrawings,

    // Pose overlay
    isPoseEnabled,
    togglePose,
    poseModelVariant,
    setPoseModelVariant,
    poseAnalyzeScope,
    setPoseAnalyzeScope,
    poseMinVisibility,
    setPoseMinVisibility: handleSetPoseMinVisibility,
    poseTargetFps,
    setPoseTargetFps: handleSetPoseTargetFps,
    poseMinPoseDetectionConfidence,
    setPoseMinPoseDetectionConfidence: handleSetPoseMinPoseDetectionConfidence,
    poseMinPosePresenceConfidence,
    setPoseMinPosePresenceConfidence: handleSetPoseMinPosePresenceConfidence,
    poseMinTrackingConfidence,
    setPoseMinTrackingConfidence: handleSetPoseMinTrackingConfidence,
    poseUseExactFrameSync,
    setPoseUseExactFrameSync,
    poseUseSmoothing,
    setPoseUseSmoothing,
    poseUsePreprocessCache,
    setPoseUsePreprocessCache,
    poseUseYoloMultiPerson,
    setPoseUseYoloMultiPerson,
    poseShowCoG,
    setPoseShowCoG,
    poseShowCoGCharts,
    setPoseShowCoGCharts,
    poseShowJointAngles,
    setPoseShowJointAngles,
    poseShowBodyLean,
    setPoseShowBodyLean,
    poseShowJumpHeight,
    setPoseShowJumpHeight,
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
