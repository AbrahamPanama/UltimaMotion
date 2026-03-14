import type { PoseAngleMetricId, PoseAngleSelectionMap } from '@/types';

export interface PoseAngleMetricDefinition {
  id: PoseAngleMetricId;
  label: string;
  chartColor: string;
}

export const POSE_ANGLE_METRICS: PoseAngleMetricDefinition[] = [
  { id: 'left-knee', label: 'L Knee', chartColor: '#22c55e' },
  { id: 'right-knee', label: 'R Knee', chartColor: '#a855f7' },
  { id: 'left-hip', label: 'L Hip', chartColor: '#06b6d4' },
  { id: 'right-hip', label: 'R Hip', chartColor: '#ec4899' },
  { id: 'left-elbow', label: 'L Elbow', chartColor: '#3b82f6' },
  { id: 'right-elbow', label: 'R Elbow', chartColor: '#f59e0b' },
];

export const createPoseAngleSelectionMap = (defaultValue: boolean): PoseAngleSelectionMap =>
  Object.fromEntries(
    POSE_ANGLE_METRICS.map((metric) => [metric.id, defaultValue])
  ) as PoseAngleSelectionMap;

export const getPoseAngleMetric = (id: PoseAngleMetricId) =>
  POSE_ANGLE_METRICS.find((metric) => metric.id === id) ?? null;
