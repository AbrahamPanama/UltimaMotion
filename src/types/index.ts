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

export type DrawingType = 'free' | 'line' | 'arrow' | 'angle' | 'rectangle' | 'circle' | 'text';

export type PoseModelVariant = 'lite' | 'full' | 'heavy' | 'yolo26-nano' | 'yolo26-small';
export type PoseAnalyzeScope = 'active-tile' | 'all-visible';

export interface Point {
  x: number;
  y: number;
}

export interface Drawing {
  id: string;
  type: DrawingType;
  points: Point[];      // For freehand/angle construction points
  start: Point;         // Generic start anchor
  end: Point;           // Generic end anchor
  color: string;
  strokeWidth: number;
  text?: string;        // For text labels
}
