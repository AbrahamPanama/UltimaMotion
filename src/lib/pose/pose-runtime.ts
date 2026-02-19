import type { PoseModelVariant } from '@/types';

export type PoseDelegate = 'GPU' | 'CPU';

export interface PoseRuntimeConfig {
  modelVariant: PoseModelVariant;
  numPoses: number;
  minPoseDetectionConfidence: number;
  minPosePresenceConfidence: number;
  minTrackingConfidence: number;
}

export interface PoseRuntimeSnapshot {
  modelVariant: PoseModelVariant | null;
  delegate: PoseDelegate | null;
}

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';

const MODEL_PATHS: Record<PoseModelVariant, string> = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
};

const buildOptionsKey = (config: PoseRuntimeConfig) =>
  [
    config.numPoses,
    config.minPoseDetectionConfidence,
    config.minPosePresenceConfidence,
    config.minTrackingConfidence,
  ].join('|');

export class PoseRuntime {
  private visionLib: typeof import('@mediapipe/tasks-vision') | null = null;
  private fileset: Awaited<
    ReturnType<typeof import('@mediapipe/tasks-vision')['FilesetResolver']['forVisionTasks']>
  > | null = null;
  private landmarker: import('@mediapipe/tasks-vision').PoseLandmarker | null = null;
  private modelVariant: PoseModelVariant | null = null;
  private delegate: PoseDelegate | null = null;
  private appliedOptionsKey = '';
  private initPromise: Promise<void> | null = null;

  private async getVisionLib() {
    if (!this.visionLib) {
      this.visionLib = await import('@mediapipe/tasks-vision');
    }
    return this.visionLib;
  }

  private async getFileset() {
    if (!this.fileset) {
      const vision = await this.getVisionLib();
      this.fileset = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
    }
    return this.fileset;
  }

  private async createLandmarker(config: PoseRuntimeConfig) {
    const vision = await this.getVisionLib();
    const fileset = await this.getFileset();
    const modelAssetPath = MODEL_PATHS[config.modelVariant];

    try {
      const gpuLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath,
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: config.numPoses,
        minPoseDetectionConfidence: config.minPoseDetectionConfidence,
        minPosePresenceConfidence: config.minPosePresenceConfidence,
        minTrackingConfidence: config.minTrackingConfidence,
        outputSegmentationMasks: false,
      });
      return { landmarker: gpuLandmarker, delegate: 'GPU' as const };
    } catch (gpuError) {
      console.warn('[PoseRuntime] GPU delegate unavailable, falling back to CPU.', gpuError);
      const cpuLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO',
        numPoses: config.numPoses,
        minPoseDetectionConfidence: config.minPoseDetectionConfidence,
        minPosePresenceConfidence: config.minPosePresenceConfidence,
        minTrackingConfidence: config.minTrackingConfidence,
        outputSegmentationMasks: false,
      });
      return { landmarker: cpuLandmarker, delegate: 'CPU' as const };
    }
  }

  private async ensureReady(config: PoseRuntimeConfig) {
    if (this.initPromise) {
      await this.initPromise;
    }

    const needsModelReload = !this.landmarker || this.modelVariant !== config.modelVariant;
    const nextOptionsKey = buildOptionsKey(config);

    if (needsModelReload) {
      this.initPromise = (async () => {
        this.landmarker?.close();
        this.landmarker = null;
        this.appliedOptionsKey = '';

        const created = await this.createLandmarker(config);
        this.landmarker = created.landmarker;
        this.delegate = created.delegate;
        this.modelVariant = config.modelVariant;
      })();

      try {
        await this.initPromise;
      } finally {
        this.initPromise = null;
      }
    }

    if (!this.landmarker) {
      throw new Error('Pose landmarker was not initialized.');
    }

    if (this.appliedOptionsKey !== nextOptionsKey) {
      await this.landmarker.setOptions({
        runningMode: 'VIDEO',
        numPoses: config.numPoses,
        minPoseDetectionConfidence: config.minPoseDetectionConfidence,
        minPosePresenceConfidence: config.minPosePresenceConfidence,
        minTrackingConfidence: config.minTrackingConfidence,
        outputSegmentationMasks: false,
      });
      this.appliedOptionsKey = nextOptionsKey;
    }
  }

  async detectForVideo(
    videoFrame: TexImageSource,
    timestampMs: number,
    config: PoseRuntimeConfig
  ): Promise<import('@mediapipe/tasks-vision').PoseLandmarkerResult | null> {
    await this.ensureReady(config);
    if (!this.landmarker) return null;
    return this.landmarker.detectForVideo(videoFrame, timestampMs);
  }

  getSnapshot(): PoseRuntimeSnapshot {
    return {
      modelVariant: this.modelVariant,
      delegate: this.delegate,
    };
  }

  close() {
    this.landmarker?.close();
    this.landmarker = null;
    this.appliedOptionsKey = '';
    this.modelVariant = null;
    this.delegate = null;
  }
}

export const createPoseRuntime = () => new PoseRuntime();
