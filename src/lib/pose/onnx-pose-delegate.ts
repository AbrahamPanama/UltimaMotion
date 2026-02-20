import type { Tensor, InferenceSession } from 'onnxruntime-web';
import { NormalizedLandmark } from '@mediapipe/tasks-vision';

// Define YOLO keypoints mapping to Mediapipe (33 keypoints)
// YOLO provides 17 keypoints (COCO format):
// 0: nose, 1: left_eye, 2: right_eye, 3: left_ear, 4: right_ear
// 5: left_shoulder, 6: right_shoulder, 7: left_elbow, 8: right_elbow
// 9: left_wrist, 10: right_wrist, 11: left_hip, 12: right_hip
// 13: left_knee, 14: right_knee, 15: left_ankle, 16: right_ankle

const YOLO_TO_MP_MAP: Record<number, number> = {
    0: 0,   // nose
    1: 2,   // left_eye
    2: 5,   // right_eye
    3: 7,   // left_ear
    4: 8,   // right_ear
    5: 11,  // left_shoulder
    6: 12,  // right_shoulder
    7: 13,  // left_elbow
    8: 14,  // right_elbow
    9: 15,  // left_wrist
    10: 16, // right_wrist
    11: 23, // left_hip
    12: 24, // right_hip
    13: 25, // left_knee
    14: 26, // right_knee
    15: 27, // left_ankle
    16: 28  // right_ankle
};

export class OnnxPoseDelegate {
    private session: InferenceSession | null = null;
    private isInitializing = false;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private ort: typeof import('onnxruntime-web') | null = null;
    private executionProvider: 'webgpu' | 'wasm' | null = null;

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = 640;
        this.canvas.height = 640;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    }

    async initialize(modelPath: string) {
        if (this.session || this.isInitializing) return;
        this.isInitializing = true;

        try {
            if (!this.ort) {
                this.ort = await import('onnxruntime-web');

                // Configure WASM environment variables statically on first load
                // Use hardware concurrency for threading, capped at a reasonable limit for browser (e.g., 4)
                const numCores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
                this.ort.env.wasm.numThreads = Math.min(numCores, 4);
                this.ort.env.wasm.simd = true;
                // Force WASM binary to load from reliable CDN instead of local Webpack chunks
                this.ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.2/dist/';
                // Silence C++ telemetry warnings that crash the Next.js dev overlay
                this.ort.env.logLevel = 'fatal';
            }

            const baseSessionOptions: import('onnxruntime-web').InferenceSession.SessionOptions = {
                graphOptimizationLevel: 'all' as const,
                // Enable further performance tweaks for WASM backend
                enableCpuMemArena: true,
                enableMemPattern: true,
                executionMode: 'sequential' as const,
                // Force any remaining dynamic axes to a static size of 1
                freeDimensionOverrides: {
                    batch: 1,       // Or 'batch_size': 1, depending on your model's input name
                }
            };

            const canTryWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
            if (canTryWebGpu) {
                try {
                    this.session = await this.ort.InferenceSession.create(modelPath, {
                        ...baseSessionOptions,
                        executionProviders: ['webgpu'],
                    });
                    this.executionProvider = 'webgpu';
                    console.log(`[ONNX] Loaded model: ${modelPath} using provider: webgpu`);
                } catch (webGpuError) {
                    console.warn('[ONNX] WebGPU provider unavailable, falling back to WASM.', webGpuError);
                }
            }

            if (!this.session) {
                this.session = await this.ort.InferenceSession.create(modelPath, {
                    ...baseSessionOptions,
                    executionProviders: ['wasm'],
                });
                this.executionProvider = 'wasm';
                console.log(`[ONNX] Loaded model: ${modelPath} using provider: wasm`);
            }
        } catch (error) {
            console.error('[ONNX] Failed to load model:', error);
            this.session = null;
            this.executionProvider = null;
            throw error;
        } finally {
            this.isInitializing = false;
        }
    }

    getExecutionProvider() {
        return this.executionProvider;
    }

    async detect(videoElement: HTMLVideoElement): Promise<import('@mediapipe/tasks-vision').PoseLandmarkerResult> {
        if (!this.ort || !this.session) return { landmarks: [], worldLandmarks: [], close: () => { } };

        // 1. Preprocess: Resize and pad video frame to 640x640, extract RGB, normalize to 0-1
        const inputTensor = this.preprocess(videoElement);

        // 2. Run Inference
        const feeds: Record<string, import('onnxruntime-web').Tensor> = {};
        feeds[this.session.inputNames[0]] = inputTensor;

        const output = await this.session.run(feeds);
        const outputTensor = output[this.session.outputNames[0]];

        // 3. Postprocess
        const landmarks = this.postprocess(outputTensor, videoElement.videoWidth, videoElement.videoHeight);

        // 4. Memory Management (CRITICAL for WebGPU to prevent leaks)
        inputTensor.dispose();
        for (const key in output) {
            output[key].dispose();
        }

        if (landmarks) {
            return { landmarks: [landmarks], worldLandmarks: [], close: () => { } };
        }

        return { landmarks: [], worldLandmarks: [], close: () => { } };
    }

    private preprocess(video: HTMLVideoElement): import('onnxruntime-web').Tensor {
        const { videoWidth, videoHeight } = video;
        const targetSize = 640;

        // Calculate scale to maintain aspect ratio
        const scale = Math.min(targetSize / videoWidth, targetSize / videoHeight);
        const newWidth = Math.round(videoWidth * scale);
        const newHeight = Math.round(videoHeight * scale);

        // Center padding
        const dx = (targetSize - newWidth) / 2;
        const dy = (targetSize - newHeight) / 2;

        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, targetSize, targetSize);
        this.ctx.drawImage(video, dx, dy, newWidth, newHeight);

        const imgData = this.ctx.getImageData(0, 0, targetSize, targetSize);
        const data = imgData.data;

        const dataLength = data.length;
        const inv255 = 1.0 / 255.0; // Multiplication is much faster than division

        // Convert to float32 tensor (1, 3, 640, 640)
        // Note: Even though we exported the model with half=True, the model
        // signatures still expect an FP32 input tensor and will internally cast.
        const float32Data = new Float32Array(3 * targetSize * targetSize);

        // BCHW format
        let rIndex = 0;
        let gIndex = targetSize * targetSize;
        let bIndex = targetSize * targetSize * 2;

        for (let i = 0; i < dataLength; i += 4) {
            float32Data[rIndex++] = data[i] * inv255;     // R
            float32Data[gIndex++] = data[i + 1] * inv255; // G
            float32Data[bIndex++] = data[i + 2] * inv255; // B
            // Ignore Alpha channel
        }

        return new this.ort!.Tensor('float32', float32Data, [1, 3, targetSize, targetSize]);
    }

    private postprocess(tensor: Tensor, originalWidth: number, originalHeight: number): NormalizedLandmark[] | null {
        // YOLO26 End-to-End Pose Output shape is [1, 300, 57]
        // 57 = 4 (bbox) + 2 (class confs or objectness + class conf) + 17*3 (kpts: x, y, conf)
        // Note: Sometimes it's 56. We'll use the dynamic `numFeatures`.

        const dims = tensor.dims;
        const data = tensor.data as Float32Array;

        if (dims.length !== 3 || dims[1] !== 300) {
            console.warn(`[ONNX] Unexpected output shape: ${dims}`);
            return null;
        }

        const numBoxes = dims[1];
        const numFeatures = dims[2];

        let bestConf = 0;
        let bestBoxIndex = -1;

        // Find the box with the highest confidence
        // Box format: [ cx, cy, w, h, class_conf_0, class_conf_1..., kp0_x, kp0_y, kp0_conf, ... ]
        // Usually, index 4 is the primary class confidence (person)
        for (let i = 0; i < numBoxes; i++) {
            const offset = i * numFeatures;
            const conf = data[offset + 4];
            if (conf > bestConf) {
                bestConf = conf;
                bestBoxIndex = i;
            }
        }

        if (bestBoxIndex === -1 || bestConf < 0.25) {
            return null;
        }

        // We have a good detection!
        const baseOffset = bestBoxIndex * numFeatures;

        // Calculate where keypoints start.
        // It's usually numFeatures - (17 * 3) = 57 - 51 = 6
        // So the first 6 elements are bbox + class scores.
        const keypointsOffset = numFeatures - (17 * 3);

        // --- Fixing the Squishing / Aspect Ratio Math ---
        // During preprocess, we letterboxed the image into a 640x640 square.
        // We scaled it by `scale`, then centered it with `dx` and `dy` padding.
        // We need to reverse this exactly to map back to the original video coordinates.
        const targetSize = 640;
        const scale = Math.min(targetSize / originalWidth, targetSize / originalHeight);

        // The *padded* dimensions on the 640x640 canvas (before centering)
        const newWidth = originalWidth * scale;
        const newHeight = originalHeight * scale;

        // The amount of padding added to each side
        const dx = (targetSize - newWidth) / 2;
        const dy = (targetSize - newHeight) / 2;

        // Create empty 33 keypoint array for MediaPipe compatibility
        const mpLandmarks: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));

        for (let k = 0; k < 17; k++) {
            const kx = data[baseOffset + keypointsOffset + (k * 3)];
            const ky = data[baseOffset + keypointsOffset + (k * 3) + 1];
            const kconf = data[baseOffset + keypointsOffset + (k * 3) + 2];

            // 1. Un-pad (remove letterbox margins)
            const unpaddedX = kx - dx;
            const unpaddedY = ky - dy;

            // 2. Un-scale (back to original video pixel dimensions)
            const origPixelX = unpaddedX / scale;
            const origPixelY = unpaddedY / scale;

            // 3. Normalize (0..1 range) for the final overlay renderer
            const normalizedX = origPixelX / originalWidth;
            const normalizedY = origPixelY / originalHeight;

            const mpIndex = YOLO_TO_MP_MAP[k];
            if (mpIndex !== undefined) {
                mpLandmarks[mpIndex] = {
                    x: normalizedX,
                    y: normalizedY,
                    z: 0,
                    visibility: kconf
                };
            }
        }

        return mpLandmarks;
    }

    close() {
        if (this.session) {
            this.session.release();
            this.session = null;
        }
        this.executionProvider = null;
    }
}

// Helper to convert Float32 to Float16 bits
function roundToFloat16Bits(val: number): number {
    const floatView = new Float32Array(1);
    const int32View = new Int32Array(floatView.buffer);
    floatView[0] = val;
    const x = int32View[0];

    const sign = (x >> 16) & 0x8000;
    let exp = (x >> 23) & 0xff;
    let mant = x & 0x007fffff;

    if (exp === 0xff) {
        if (mant !== 0) return sign | 0x7e00 | (mant >> 13);
        return sign | 0x7c00;
    }

    if (exp === 0) return sign;

    exp -= 127;
    if (exp > 15) return sign | 0x7c00;
    if (exp < -14) {
        mant |= 0x00800000;
        const shift = -14 - exp;
        if (shift > 24) return sign;
        mant >>= shift;
        return sign | (mant >> 13);
    }

    return sign | ((exp + 15) << 10) | (mant >> 13);
}
