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

interface OnnxDetectOptions {
    multiPerson?: boolean;
    maxPoses?: number;
    minConfidence?: number;
    iouThreshold?: number;
}

interface YoloDetectionCandidate {
    boxIndex: number;
    confidence: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

type OrtModule = typeof import('onnxruntime-web');

const ONNX_RUNTIME_VERSION = '1.24.2';
const ORT_WASM_CDN_ROOT = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_RUNTIME_VERSION}/dist/`;
const ORT_CDN_WEBGPU_MODULE_URL =
    `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_RUNTIME_VERSION}/dist/ort.webgpu.bundle.min.mjs`;
const ORT_CDN_BUNDLE_MODULE_URL =
    `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_RUNTIME_VERSION}/dist/ort.bundle.min.mjs`;

export class OnnxPoseDelegate {
    private static readonly TARGET_SIZE = 640;
    private static readonly PIXEL_COUNT = OnnxPoseDelegate.TARGET_SIZE * OnnxPoseDelegate.TARGET_SIZE;
    private static readonly YOLO_KEYPOINT_COUNT = 17;
    private static readonly FEATURES_PER_KEYPOINT = 3;
    private static readonly DEFAULT_MIN_CONFIDENCE = 0.25;
    private static readonly DEFAULT_NMS_IOU = 0.5;

    private session: InferenceSession | null = null;
    private isInitializing = false;
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private ort: typeof import('onnxruntime-web') | null = null;
    private executionProvider: 'webgpu' | 'wasm' | null = null;
    private readonly inputData = new Float32Array(OnnxPoseDelegate.PIXEL_COUNT * 3);
    private inputTensor: import('onnxruntime-web').Tensor | null = null;
    private inputName: string | null = null;
    private readonly feeds: Record<string, import('onnxruntime-web').Tensor> = {};

    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = OnnxPoseDelegate.TARGET_SIZE;
        this.canvas.height = OnnxPoseDelegate.TARGET_SIZE;
        this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    }

    private async importOrtModule(): Promise<OrtModule> {
        const attempts: Array<{ label: string; load: () => Promise<OrtModule> }> = [
            {
                label: 'onnxruntime-web/webgpu',
                load: () => import('onnxruntime-web/webgpu') as Promise<OrtModule>,
            },
            {
                label: 'onnxruntime-web',
                load: () => import('onnxruntime-web'),
            },
            {
                label: 'cdn:ort.webgpu.bundle.min.mjs',
                load: () =>
                    import(
                        /* webpackIgnore: true */ ORT_CDN_WEBGPU_MODULE_URL
                    ) as Promise<OrtModule>,
            },
            {
                label: 'cdn:ort.bundle.min.mjs',
                load: () =>
                    import(
                        /* webpackIgnore: true */ ORT_CDN_BUNDLE_MODULE_URL
                    ) as Promise<OrtModule>,
            },
        ];

        let lastError: unknown = null;
        for (const attempt of attempts) {
            try {
                const ortModule = await attempt.load();
                if (attempt.label.startsWith('cdn:')) {
                    console.warn(
                        `[ONNX] Loaded runtime via CDN fallback (${attempt.label}).`
                    );
                }
                return ortModule;
            } catch (error) {
                lastError = error;
                console.warn(`[ONNX] Runtime import failed (${attempt.label}).`, error);
            }
        }

        throw new Error(
            `[ONNX] Failed to load onnxruntime-web runtime from local bundle and CDN fallbacks. Last error: ${
                lastError instanceof Error ? lastError.message : String(lastError)
            }`
        );
    }

    async initialize(modelPath: string) {
        if (this.session || this.isInitializing) return;
        this.isInitializing = true;

        try {
            if (!this.ort) {
                this.ort = await this.importOrtModule();

                // Configure WASM environment variables statically on first load
                // Use hardware concurrency for threading, capped at a reasonable limit for browser (e.g., 4)
                const numCores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
                this.ort.env.wasm.numThreads = Math.min(numCores, 4);
                this.ort.env.wasm.simd = true;
                // Force WASM binary to load from reliable CDN instead of local Webpack chunks
                this.ort.env.wasm.wasmPaths = ORT_WASM_CDN_ROOT;
                // Silence C++ telemetry warnings that crash the Next.js dev overlay
                this.ort.env.logLevel = 'fatal';
            }

            const baseSessionOptions: import('onnxruntime-web').InferenceSession.SessionOptions = {
                graphOptimizationLevel: 'all' as const,
                // Suppress benign ORT warnings (like partial EP assignment) while keeping real errors.
                logSeverityLevel: 3,
                logVerbosityLevel: 0,
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

            if (this.session) {
                this.inputName = this.session.inputNames[0] ?? null;
                this.inputTensor = new this.ort.Tensor(
                    'float32',
                    this.inputData,
                    [1, 3, OnnxPoseDelegate.TARGET_SIZE, OnnxPoseDelegate.TARGET_SIZE]
                );
            }
        } catch (error) {
            console.error('[ONNX] Failed to load model:', error);
            this.session = null;
            this.executionProvider = null;
            this.inputName = null;
            this.inputTensor = null;
            throw error;
        } finally {
            this.isInitializing = false;
        }
    }

    getExecutionProvider() {
        return this.executionProvider;
    }

    async detect(
        videoElement: HTMLVideoElement,
        options: OnnxDetectOptions = {}
    ): Promise<import('@mediapipe/tasks-vision').PoseLandmarkerResult> {
        if (!this.ort || !this.session || !this.inputTensor || !this.inputName) {
            return { landmarks: [], worldLandmarks: [], close: () => { } };
        }
        if (videoElement.videoWidth <= 0 || videoElement.videoHeight <= 0) {
            return { landmarks: [], worldLandmarks: [], close: () => { } };
        }

        // 1. Preprocess: Resize and pad video frame to 640x640, extract RGB, normalize to 0-1
        const inputTensor = this.preprocess(videoElement);

        let output: Record<string, Tensor> | null = null;
        try {
            // 2. Run Inference
            this.feeds[this.inputName] = inputTensor;
            output = await this.session.run(this.feeds);
            const outputTensor = output[this.session.outputNames[0]];

            if (!outputTensor) {
                return { landmarks: [], worldLandmarks: [], close: () => { } };
            }

            // 3. Postprocess
            const landmarks = this.postprocess(
                outputTensor,
                videoElement.videoWidth,
                videoElement.videoHeight,
                options
            );

            if (landmarks.length > 0) {
                return { landmarks, worldLandmarks: [], close: () => { } };
            }

            return { landmarks: [], worldLandmarks: [], close: () => { } };
        } finally {
            // Always release output tensor resources, even if inference/postprocess throws.
            if (output) {
                for (const key in output) {
                    output[key].dispose();
                }
            }
        }
    }

    private preprocess(video: HTMLVideoElement): import('onnxruntime-web').Tensor {
        const { videoWidth, videoHeight } = video;
        const targetSize = OnnxPoseDelegate.TARGET_SIZE;

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
        const float32Data = this.inputData;

        // BCHW format
        let rIndex = 0;
        let gIndex = OnnxPoseDelegate.PIXEL_COUNT;
        let bIndex = OnnxPoseDelegate.PIXEL_COUNT * 2;

        for (let i = 0; i < dataLength; i += 4) {
            float32Data[rIndex++] = data[i] * inv255;     // R
            float32Data[gIndex++] = data[i + 1] * inv255; // G
            float32Data[bIndex++] = data[i + 2] * inv255; // B
            // Ignore Alpha channel
        }

        return this.inputTensor!;
    }

    private postprocess(
        tensor: Tensor,
        originalWidth: number,
        originalHeight: number,
        options: OnnxDetectOptions
    ): NormalizedLandmark[][] {
        // YOLO26 End-to-End Pose Output shape is [1, 300, 57]
        // 57 = 4 (bbox) + 2 (class confs or objectness + class conf) + 17*3 (kpts: x, y, conf)
        // Note: Sometimes it's 56. We'll use the dynamic `numFeatures`.

        const dims = tensor.dims;
        const data = tensor.data as Float32Array;

        if (dims.length !== 3 || dims[1] <= 0) {
            console.warn(`[ONNX] Unexpected output shape: ${dims}`);
            return [];
        }

        const numBoxes = dims[1];
        const numFeatures = dims[2];
        const keypointValues = OnnxPoseDelegate.YOLO_KEYPOINT_COUNT * OnnxPoseDelegate.FEATURES_PER_KEYPOINT;

        if (numFeatures < 4 + keypointValues) {
            console.warn(`[ONNX] Insufficient feature width for pose decoding: ${numFeatures}`);
            return [];
        }

        const minConfidence = Math.max(0, Math.min(1, options.minConfidence ?? OnnxPoseDelegate.DEFAULT_MIN_CONFIDENCE));
        const allowMultiple = Boolean(options.multiPerson);
        const maxPoses = Math.max(1, Math.floor(options.maxPoses ?? 1));
        const iouThreshold = Math.max(0, Math.min(1, options.iouThreshold ?? OnnxPoseDelegate.DEFAULT_NMS_IOU));

        const candidates: YoloDetectionCandidate[] = [];

        // Collect confident candidates.
        for (let i = 0; i < numBoxes; i++) {
            const offset = i * numFeatures;
            const confidence = data[offset + 4];
            if (!Number.isFinite(confidence) || confidence < minConfidence) {
                continue;
            }

            const cx = data[offset + 0];
            const cy = data[offset + 1];
            const w = data[offset + 2];
            const h = data[offset + 3];

            if (![cx, cy, w, h].every(Number.isFinite)) {
                continue;
            }

            const halfW = Math.max(0, w) * 0.5;
            const halfH = Math.max(0, h) * 0.5;
            candidates.push({
                boxIndex: i,
                confidence,
                x1: cx - halfW,
                y1: cy - halfH,
                x2: cx + halfW,
                y2: cy + halfH,
            });
        }

        if (candidates.length === 0) {
            return [];
        }

        candidates.sort((a, b) => b.confidence - a.confidence);

        const selected: YoloDetectionCandidate[] = [];
        for (const candidate of candidates) {
            if (!allowMultiple && selected.length >= 1) {
                break;
            }
            if (allowMultiple && selected.length >= maxPoses) {
                break;
            }

            if (
                allowMultiple &&
                selected.some((kept) => OnnxPoseDelegate.computeIoU(kept, candidate) > iouThreshold)
            ) {
                continue;
            }

            selected.push(candidate);
        }

        if (selected.length === 0) {
            return [];
        }

        return selected.map((candidate) =>
            this.decodePoseFromBox(data, numFeatures, candidate.boxIndex, originalWidth, originalHeight)
        );
    }

    private decodePoseFromBox(
        data: Float32Array,
        numFeatures: number,
        boxIndex: number,
        originalWidth: number,
        originalHeight: number
    ): NormalizedLandmark[] {
        const baseOffset = boxIndex * numFeatures;
        const keypointsOffset = numFeatures - (
            OnnxPoseDelegate.YOLO_KEYPOINT_COUNT * OnnxPoseDelegate.FEATURES_PER_KEYPOINT
        );

        // --- Fixing the Squishing / Aspect Ratio Math ---
        // During preprocess, we letterboxed the image into a 640x640 square.
        // We scaled it by `scale`, then centered it with `dx` and `dy` padding.
        // We need to reverse this exactly to map back to the original video coordinates.
        const targetSize = OnnxPoseDelegate.TARGET_SIZE;
        const scale = Math.min(targetSize / originalWidth, targetSize / originalHeight);

        // The *padded* dimensions on the 640x640 canvas (before centering)
        const newWidth = originalWidth * scale;
        const newHeight = originalHeight * scale;

        // The amount of padding added to each side
        const dx = (targetSize - newWidth) / 2;
        const dy = (targetSize - newHeight) / 2;

        // Create empty 33 keypoint array for MediaPipe compatibility
        const mpLandmarks: NormalizedLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));

        for (let k = 0; k < OnnxPoseDelegate.YOLO_KEYPOINT_COUNT; k++) {
            const kx = data[baseOffset + keypointsOffset + (k * 3)];
            const ky = data[baseOffset + keypointsOffset + (k * 3) + 1];
            const kconfRaw = data[baseOffset + keypointsOffset + (k * 3) + 2];

            // 1. Un-pad (remove letterbox margins)
            const unpaddedX = kx - dx;
            const unpaddedY = ky - dy;

            // 2. Un-scale (back to original video pixel dimensions)
            const origPixelX = unpaddedX / scale;
            const origPixelY = unpaddedY / scale;

            // 3. Normalize (0..1 range) for the final overlay renderer
            const normalizedX = OnnxPoseDelegate.clamp01(origPixelX / originalWidth);
            const normalizedY = OnnxPoseDelegate.clamp01(origPixelY / originalHeight);
            const visibility = Number.isFinite(kconfRaw) ? OnnxPoseDelegate.clamp01(kconfRaw) : 0;

            const mpIndex = YOLO_TO_MP_MAP[k];
            if (mpIndex !== undefined) {
                mpLandmarks[mpIndex] = {
                    x: normalizedX,
                    y: normalizedY,
                    z: 0,
                    visibility
                };
            }
        }

        return mpLandmarks;
    }

    private static computeIoU(a: YoloDetectionCandidate, b: YoloDetectionCandidate) {
        const x1 = Math.max(a.x1, b.x1);
        const y1 = Math.max(a.y1, b.y1);
        const x2 = Math.min(a.x2, b.x2);
        const y2 = Math.min(a.y2, b.y2);

        const interW = Math.max(0, x2 - x1);
        const interH = Math.max(0, y2 - y1);
        const interArea = interW * interH;
        if (interArea <= 0) {
            return 0;
        }

        const areaA = Math.max(0, (a.x2 - a.x1) * (a.y2 - a.y1));
        const areaB = Math.max(0, (b.x2 - b.x1) * (b.y2 - b.y1));
        const union = areaA + areaB - interArea;
        if (union <= 0) {
            return 0;
        }

        return interArea / union;
    }

    private static clamp01(value: number) {
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.max(0, Math.min(1, value));
    }

    close() {
        if (this.session) {
            this.session.release();
            this.session = null;
        }
        this.inputTensor?.dispose();
        this.inputTensor = null;
        this.inputName = null;
        this.executionProvider = null;
    }
}
