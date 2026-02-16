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

export type DrawingType = 'free' | 'arrow' | 'circle';

export interface Point {
    x: number;
    y: number;
}

export interface Drawing {
    id: string;
    type: DrawingType;
    points: Point[];      // For freehand
    start: Point;         // For arrow/circle
    end: Point;           // For arrow/circle
    color: string;
    strokeWidth: number;
}
