export type Video = {
  id: string;
  name: string;
  url: string;
  blob: Blob;
  duration: number;
  createdAt: Date;
  trimStart?: number; // New: Start time in seconds
  trimEnd?: number;   // New: End time in seconds
  thumbnail?: string; // New: Base64 data URL for thumbnail
};
