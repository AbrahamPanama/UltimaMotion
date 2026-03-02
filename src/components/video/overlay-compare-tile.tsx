'use client';

import { useEffect, useRef, type MutableRefObject } from 'react';
import type { Video } from '@/types';
import type { OverlayBlendMode, OverlayColorFilter } from '@/contexts/app-context';
import { cn } from '@/lib/utils';
import { X } from 'lucide-react';

interface OverlayCompareTileProps {
  baseVideo: Video;
  topVideo: Video;
  baseIndex: number;
  topIndex: number;
  videoRefs: MutableRefObject<(HTMLVideoElement | null)[]>;
  isPortraitMode: boolean;
  isMuted: boolean;
  overlayOpacity: number;
  overlayBlendMode: OverlayBlendMode;
  overlayTopColorFilter: OverlayColorFilter;
  overlayTopBlackAndWhite: boolean;
  onRemoveBase: () => void;
  onRemoveTop: () => void;
}

export default function OverlayCompareTile({
  baseVideo,
  topVideo,
  baseIndex,
  topIndex,
  videoRefs,
  isPortraitMode,
  isMuted,
  overlayOpacity,
  overlayBlendMode,
  overlayTopColorFilter,
  overlayTopBlackAndWhite,
  onRemoveBase,
  onRemoveTop,
}: OverlayCompareTileProps) {
  const baseRef = useRef<HTMLVideoElement | null>(null);
  const topRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const refs = videoRefs.current;
    const baseNode = baseRef.current;
    const topNode = topRef.current;

    refs[baseIndex] = baseNode;
    refs[topIndex] = topNode;

    return () => {
      if (refs[baseIndex] === baseNode) {
        refs[baseIndex] = null;
      }
      if (refs[topIndex] === topNode) {
        refs[topIndex] = null;
      }
    };
  }, [baseIndex, baseVideo.id, topIndex, topVideo.id, videoRefs]);

  const topVideoFilter = (() => {
    const colorFilter = {
      none: 'none',
      red: 'grayscale(1) sepia(1) hue-rotate(-38deg) saturate(8.5) contrast(1.28) brightness(0.94)',
      orange: 'grayscale(1) sepia(1) hue-rotate(-12deg) saturate(8) contrast(1.25) brightness(0.97)',
      yellow: 'grayscale(1) sepia(1) hue-rotate(20deg) saturate(8.8) contrast(1.3) brightness(1.02)',
      green: 'grayscale(1) sepia(1) hue-rotate(78deg) saturate(8.2) contrast(1.26) brightness(0.95)',
      blue: 'grayscale(1) sepia(1) hue-rotate(168deg) saturate(8.6) contrast(1.29) brightness(0.93)',
    }[overlayTopColorFilter];

    const parts = colorFilter === 'none' ? [] : [colorFilter];
    if (overlayTopBlackAndWhite) parts.push('grayscale(1)');
    return parts.length > 0 ? parts.join(' ') : 'none';
  })();

  return (
    <div
      className={cn(
        'relative h-full w-full overflow-hidden rounded-lg border bg-black shadow-sm',
        isPortraitMode ? 'aspect-[9/16]' : 'aspect-video'
      )}
    >
      <video
        ref={baseRef}
        src={baseVideo.url}
        className={cn('h-full w-full touch-none', isPortraitMode ? 'object-cover' : 'object-contain')}
        playsInline
        muted={isMuted}
      />
      <video
        ref={topRef}
        src={topVideo.url}
        className={cn('pointer-events-none absolute inset-0 h-full w-full touch-none', isPortraitMode ? 'object-cover' : 'object-contain')}
        style={{
          opacity: overlayOpacity,
          mixBlendMode: overlayBlendMode,
          filter: topVideoFilter,
        }}
        playsInline
        muted
      />

      <div className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-md border border-white/20 bg-black/55 px-2 py-1 text-[10px] font-medium text-white/90 backdrop-blur-sm">
        <span>Overlay</span>
        <span className="text-white/60">|</span>
        <span className="uppercase">{overlayBlendMode}</span>
        <span className="text-white/60">|</span>
        <span>{Math.round(overlayOpacity * 100)}%</span>
      </div>

      <div className="absolute right-2 top-2 z-20 flex items-center gap-1">
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white/90 transition-colors hover:bg-destructive/85"
          onClick={onRemoveBase}
          title={`Remove base clip: ${baseVideo.name}`}
          aria-label="Remove base clip"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/25 bg-black/55 text-white/90 transition-colors hover:bg-destructive/85"
          onClick={onRemoveTop}
          title={`Remove top clip: ${topVideo.name}`}
          aria-label="Remove top clip"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
