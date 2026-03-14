import type { PoseModelVariant } from '@/types';
import {
  POSE_PREPROCESS_PRESETS,
  formatPoseProcessingLabel,
  type PosePreprocessPreset,
} from '@/lib/pose/pose-preprocess-preset';

export const POSE_PROCESS_MODEL_OPTIONS: Array<{ variant: PoseModelVariant; label: string }> = [
  { variant: 'yolo26-medium', label: 'Medium' },
  { variant: 'yolo26-large', label: 'Full' },
  { variant: 'yolo26-xlarge', label: 'Heavy' },
  { variant: 'heavy', label: 'MP Heavy' },
];

export const getPoseProcessModelLabel = (variant: PoseModelVariant | string | null | undefined) => {
  if (!variant) return 'Unknown';
  const option = POSE_PROCESS_MODEL_OPTIONS.find((item) => item.variant === variant);
  if (option) return option.label;
  switch (variant) {
    case 'yolo26-small':
      return 'Small';
    case 'yolo26-nano':
      return 'Nano';
    case 'heavy':
      return 'MP Heavy';
    case 'full':
      return 'MP Full';
    case 'lite':
      return 'MP Lite';
    default:
      return variant;
  }
};

export interface PoseProcessMenuOption {
  variant: PoseModelVariant;
  preset: PosePreprocessPreset;
  label: string;
}

export const POSE_PROCESS_MENU_OPTIONS: PoseProcessMenuOption[] = POSE_PROCESS_MODEL_OPTIONS.flatMap((option) =>
  POSE_PREPROCESS_PRESETS.map((preset) => ({
    variant: option.variant,
    preset,
    label: formatPoseProcessingLabel(option.variant, preset.id, getPoseProcessModelLabel),
  }))
);
