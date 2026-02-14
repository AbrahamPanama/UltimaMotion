import type { Video } from '@/types';

const DB_NAME = 'UltimaMotionDB';
const DB_VERSION = 1;
const STORE_NAME = 'videos';

let db: IDBDatabase;

export const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (db) {
      return resolve(db);
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error("IndexedDB error:", request.error);
      reject('Error opening database');
    };

    request.onsuccess = (event) => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

export const addVideo = (video: Omit<Video, 'url'>): Promise<void> => {
  return new Promise(async (resolve, reject) => {
    const db = await initDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
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
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
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
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => {
      console.error("Error deleting video:", request.error);
      reject('Error deleting video');
    };
  });
};
