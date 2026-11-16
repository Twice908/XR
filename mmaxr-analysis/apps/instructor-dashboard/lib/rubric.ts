import type { RubricDimension } from './types'

export const DIMENSIONS: { key: RubricDimension; label: string; color: string }[] = [
  { key: 'prediction',    label: 'Prediction',    color: '#3b82f6' },
  { key: 'retrieval',     label: 'Retrieval',     color: '#8b5cf6' },
  { key: 'revision',      label: 'Revision',      color: '#ec4899' },
  { key: 'causal',        label: 'Causal',        color: '#f59e0b' },
  { key: 'metacognition', label: 'Metacognition', color: '#10b981' },
  { key: 'transfer',      label: 'Transfer',      color: '#06b6d4' },
]

export function dimensionMeta(key: RubricDimension | null) {
  return DIMENSIONS.find((d) => d.key === key) ?? {
    key: 'unclassified' as const,
    label: 'Unclassified',
    color: '#9ca3af',
  }
}