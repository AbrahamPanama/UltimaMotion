import type { Video } from '@/types';

const DB_NAME = 'UltimaMotionDB';
const DB_VERSION = 2;
const VIDEO_STORE_NAME = 'videos';
const POSE_ANALYSIS_STORE_NAME = 'pose_analyses';

export type SerializedLandmark = [number, number, number, number];
export type SerializedPose = SerializedLandmark[];

export interface PoseAnalysisFrame {
  t: number;
  poses: SerializedPose[];
}

export interface PoseAnalysisRecord {
  id: string;
  videoId: string;
  modelVariant: string;
  targetFps: number;
  yoloMultiPerson: boolean;
  trimStartMs: number;
  trimEndMs: number;
  createdAtMs: number;
  frames: PoseAnalysisFrame[];
}

let db: IDBDatabase;

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (db) {
      return resolve(db);
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("IndexedDB error:", request.error);
      reject('Error opening database');
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VIDEO_STORE_NAME)) {
        db.createObjectStore(VIDEO_STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(POSE_ANALYSIS_STORE_NAME)) {
        const analysisStore = db.createObjectStore(POSE_ANALYSIS_STORE_NAME, { keyPath: 'id' });
        analysisStore.createIndex('videoId', 'videoId', { unique: false });
      } else {
        const analysisStore = request.transaction?.objectStore(POSE_ANALYSIS_STORE_NAME);
        if (analysisStore && !analysisStore.indexNames.contains('videoId')) {
          analysisStore.createIndex('videoId', 'videoId', { unique: false });
        }
      }
    };
  });
};

export const addVideo = (video: Omit<Video, 'url'>): Promise<void> => {
  return new Promise(async (resolve, reject) => {
    const db = await initDB();
    const transaction = db.transaction(VIDEO_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(VIDEO_STORE_NAME);
    const request = store.put(video);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error("Error adding video:", request.error);
      reject('Error adding video');
    };
  });
};

export const getAllVideos = (): Promise<Omit<Video, 'url'>[]> => {
  return new Promise(async (resolve, reject) => {
    const db = await initDB();
    const transaction = db.transaction(VIDEO_STORE_NAME, 'readonly');
    const store = transaction.objectStore(VIDEO_STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
        const sortedVideos = request.result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        resolve(sortedVideos);
    };
    request.onerror = () => {
      console.error("Error getting videos:", request.error);
      reject('Error getting videos');
    };
  });
};

export const deleteVideo = (id: string): Promise<void> => {
  return new Promise(async (resolve, reject) => {
    const db = await initDB();
    const transaction = db.transaction([VIDEO_STORE_NAME, POSE_ANALYSIS_STORE_NAME], 'readwrite');
    const videoStore = transaction.objectStore(VIDEO_STORE_NAME);
    const poseStore = transaction.objectStore(POSE_ANALYSIS_STORE_NAME);
    const index = poseStore.index('videoId');
    const keyRange = IDBKeyRange.only(id);
    const analysisRequest = index.openKeyCursor(keyRange);
    videoStore.delete(id);

    analysisRequest.onsuccess = () => {
      const cursor = analysisRequest.result;
      if (cursor) {
        poseStore.delete(cursor.primaryKey);
        cursor.continue();
      }
    };
    analysisRequest.onerror = () => {
      console.error("Error deleting pose analysis keys:", analysisRequest.error);
      reject('Error deleting related pose analyses');
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      console.error("Error deleting video:", transaction.error);
      reject('Error deleting video');
    };
    transaction.onabort = () => {
      console.error("Transaction aborted while deleting video.");
      reject('Error deleting video');
    };
  });
};

export const putPoseAnalysis = (analysis: PoseAnalysisRecord): Promise<void> => {
  return new Promise(async (resolve, reject) => {
    const db = await initDB();
    const transaction = db.transaction(POSE_ANALYSIS_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(POSE_ANALYSIS_STORE_NAME);
    const request = store.put(analysis);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error("Error writing pose analysis:", request.error);
      reject('Error writing pose analysis');
    };
  });
};

export const getPoseAnalysis = (id: string): Promise<PoseAnalysisRecord | null> => {
  return new Promise(async (resolve, reject) => {
    const db = await initDB();
    const transaction = db.transaction(POSE_ANALYSIS_STORE_NAME, 'readonly');
    const store = transaction.objectStore(POSE_ANALYSIS_STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
      resolve((request.result as PoseAnalysisRecord | undefined) ?? null);
    };
    request.onerror = () => {
      console.error("Error reading pose analysis:", request.error);
      reject('Error reading pose analysis');
    };
  });
};

export const deletePoseAnalysis = (id: string): Promise<void> => {
  return new Promise(async (resolve, reject) => {
    const db = await initDB();
    const transaction = db.transaction(POSE_ANALYSIS_STORE_NAME, 'readwrite');
    const store = transaction.objectStore(POSE_ANALYSIS_STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error("Error deleting pose analysis:", request.error);
      reject('Error deleting pose analysis');
    };
  });
};
