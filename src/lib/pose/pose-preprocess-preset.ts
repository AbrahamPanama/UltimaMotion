import type { PoseModelVariant, PosePreprocessPresetId } from '@/types';

export interface PosePreprocessPreset {
  id: PosePreprocessPresetId;
  label: string;
  targetFps: number;
  inputSize: number;
}

export const POSE_PREPROCESS_PRESETS: PosePreprocessPreset[] = [
  // Current YOLO ONNX exports are fixed to a 640x640 input tensor.
  // We can trade sampling cadence for preprocessing speed, but not tensor size
  // until we ship dynamic-shape model exports.
  { id: 'accurate', label: 'Accurate', targetFps: 60, inputSize: 640 },
  { id: 'balanced', label: 'Balanced', targetFps: 30, inputSize: 640 },
  { id: 'fast', label: 'Fast', targetFps: 24, inputSize: 640 },
];

export const getPosePreprocessPreset = (
  presetId: PosePreprocessPresetId | string | null | undefined
): PosePreprocessPreset => {
  const preset = POSE_PREPROCESS_PRESETS.find((item) => item.id === presetId);
  return preset ?? POSE_PREPROCESS_PRESETS[0];
};

export const getPosePreprocessPresetLabel = (
  presetId: PosePreprocessPresetId | string | null | undefined
) => getPosePreprocessPreset(presetId).label;

export const formatPoseProcessingLabel = (
  modelVariant: PoseModelVariant | string | null | undefined,
  presetId: PosePreprocessPresetId | string | null | undefined,
  getModelLabel: (variant: PoseModelVariant | string | null | undefined) => string
) => `${getModelLabel(modelVariant)} / ${getPosePreprocessPresetLabel(presetId)}`;
