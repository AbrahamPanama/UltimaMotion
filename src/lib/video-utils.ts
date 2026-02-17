'use client';

/**
 * iOS-compatible video frame extraction.
 * 
 * iOS Safari requires:
 * 1. preload='auto' (not 'metadata') to load enough data for seeking
 * 2. A brief play() call to "warm up" the decoder before canvas drawing works
 * 3. playsInline + muted attributes for programmatic control without user gesture
 * 4. Waiting for 'canplay' (not just 'loadedmetadata') before seeking
 */

/**
 * Returns the best supported MIME type for MediaRecorder.
 * iOS Safari only supports video/mp4; Chrome/Firefox prefer video/webm.
 */
export function getSupportedMimeType(): string {
    if (typeof MediaRecorder === 'undefined') return '';

    const candidates = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4',
    ];

    for (const mime of candidates) {
        if (MediaRecorder.isTypeSupported(mime)) {
            return mime;
        }
    }
    return ''; // let the browser pick its default
}

/**
 * Extracts a single frame from a video file/blob and returns it as a data URL.
 */
export async function extractThumbnail(
    source: Blob | File,
    seekTime: number = 0,
    maxWidth: number = 320
): Promise<{ thumbnail: string; duration: number }> {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', ''); // iOS requires the attribute
        video.crossOrigin = 'anonymous';

        let resolved = false;
        const cleanup = () => {
            if (resolved) return;
            resolved = true;
            URL.revokeObjectURL(video.src);
        };

        // Timeout fallback — if nothing works after 5s, return empty
        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                URL.revokeObjectURL(video.src);
                resolve({ thumbnail: '', duration: video.duration || 0 });
            }
        }, 5000);

        const drawFrame = () => {
            clearTimeout(timeout);
            const duration = video.duration;
            const vw = video.videoWidth;
            const vh = video.videoHeight;

            if (!vw || !vh) {
                cleanup();
                resolve({ thumbnail: '', duration: duration || 0 });
                return;
            }

            const scale = maxWidth / vw;
            const canvas = document.createElement('canvas');
            canvas.width = maxWidth;
            canvas.height = Math.round(vh * scale);

            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
                cleanup();
                resolve({ thumbnail, duration });
            } else {
                cleanup();
                resolve({ thumbnail: '', duration });
            }
        };

        video.onseeked = drawFrame;

        video.oncanplay = () => {
            // Seek to the requested time once enough data is loaded
            video.currentTime = seekTime;
        };

        video.onerror = () => {
            clearTimeout(timeout);
            cleanup();
            resolve({ thumbnail: '', duration: 0 });
        };

        video.src = URL.createObjectURL(source);
        // iOS: brief play() to warm up the decoder, then immediately pause
        video.play().then(() => video.pause()).catch(() => { });
    });
}

/**
 * Generates filmstrip thumbnails from a video blob.
 * Returns an array of data URL strings.
 */
export async function generateFilmstrip(
    source: Blob | File,
    opts: { stripHeight?: number; stripWidth?: number } = {}
): Promise<{ thumbnails: string[]; duration: number; videoWidth: number; videoHeight: number }> {
    const { stripHeight = 64, stripWidth = 750 } = opts;

    return new Promise(async (resolve) => {
        const video = document.createElement('video');
        video.preload = 'auto';
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.crossOrigin = 'anonymous';

        const url = URL.createObjectURL(source);
        video.src = url;

        // Timeout fallback
        const timeout = setTimeout(() => {
            URL.revokeObjectURL(url);
            resolve({ thumbnails: [], duration: 0, videoWidth: 0, videoHeight: 0 });
        }, 15000);

        // Wait for enough data to seek
        await new Promise<void>((res) => {
            video.oncanplay = () => res();
            video.onerror = () => res();
        });

        // iOS: warm up the decoder with a brief play
        try {
            await video.play();
            video.pause();
        } catch {
            // play() may fail without user gesture on some browsers; that's OK
        }

        const vidDuration = video.duration;
        const vidWidth = video.videoWidth;
        const vidHeight = video.videoHeight;

        if (!vidDuration || !isFinite(vidDuration) || !vidWidth || !vidHeight) {
            clearTimeout(timeout);
            URL.revokeObjectURL(url);
            resolve({ thumbnails: [], duration: vidDuration || 0, videoWidth: vidWidth || 0, videoHeight: vidHeight || 0 });
            return;
        }

        const isPortrait = vidHeight > vidWidth;
        const aspectRatio = isPortrait ? (2 / 3) : (3 / 2);
        const thumbWidth = stripHeight * aspectRatio;
        const count = Math.ceil(stripWidth / thumbWidth);
        const interval = vidDuration / count;

        const renderHeight = stripHeight * 2;
        const renderWidth = Math.floor(renderHeight * aspectRatio);
        const targetRatio = renderWidth / renderHeight;

        const thumbs: string[] = [];

        try {
            for (let i = 0; i < count; i++) {
                const time = Math.min(i * interval, vidDuration - 0.1);
                video.currentTime = time;

                // Wait for seeked event OR timeout
                await new Promise<void>((res) => {
                    video.onseeked = () => res();
                    setTimeout(res, 800); // iOS fallback
                });

                // Extra frame to let the decoder render
                await new Promise<void>((r) => requestAnimationFrame(() => r()));

                const canvas = document.createElement('canvas');
                canvas.width = renderWidth;
                canvas.height = renderHeight;
                const ctx = canvas.getContext('2d');

                if (ctx) {
                    // Center-crop to target ratio
                    let sx = 0, sy = 0, sWidth = vidWidth, sHeight = vidHeight;
                    const sourceRatio = vidWidth / vidHeight;

                    if (sourceRatio > targetRatio) {
                        const newWidth = vidHeight * targetRatio;
                        sx = (vidWidth - newWidth) / 2;
                        sWidth = newWidth;
                    } else {
                        const newHeight = vidWidth / targetRatio;
                        sy = (vidHeight - newHeight) / 2;
                        sHeight = newHeight;
                    }

                    ctx.drawImage(video, sx, sy, sWidth, sHeight, 0, 0, renderWidth, renderHeight);
                    thumbs.push(canvas.toDataURL('image/jpeg', 0.8));
                }
            }
        } catch (e) {
            console.error('Filmstrip generation error:', e);
        }

        clearTimeout(timeout);
        URL.revokeObjectURL(url);
        resolve({ thumbnails: thumbs, duration: vidDuration, videoWidth: vidWidth, videoHeight: vidHeight });
    });
}
