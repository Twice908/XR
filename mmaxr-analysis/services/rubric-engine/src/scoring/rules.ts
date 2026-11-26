import type { DimensionKey, DimensionResult } from './types';

/*
 * The scoring rules every lab shares. A lab may decide *what* goes into a ratio (which answers, which explanations),
 * but the step from that 0-1 ratio to a 0-3 score, and the overall percentage, are the same everywhere.
 *
 * Documented exceptions (by design, not drift):
 *  - Biology tours have no predictions or confidence ratings, so prediction discipline, retrieval effort, revision and
 *    calibration are not assessed there.
 *  - Chemistry and Metals have no transfer task.
 *  - Mission labs (Atom Builder, Ionic Bonding, Plant vs Animal Cell) map the six dimensions onto checks, hints and
 *    checkpoint questions (see missions.ts). The cell lab has no checks, so only retrieval effort, causal coherence
 *    and transfer are assessed there.
 *  - The Bohr stub (physics-101) keeps its legacy scorer until the lab is built.
 */

/** 0-1 ratio → 0-3 score. Used for revision, causal coherence and transfer in every lab. */
export const BANDS = { three: 0.9, two: 0.65, one: 0.35 } as const;
export const band = (ratio: number): number => (ratio >= BANDS.three ? 3 : ratio >= BANDS.two ? 2 : ratio >= BANDS.one ? 1 : 0);

/**
 * Overall score. When the session is complete it is the points over the dimensions that could be assessed. While it is
 * still running, every dimension the lab assesses counts towards the maximum, so a student who stops early on easy items
 * is not shown a high percentage.
 */
export function overall(dims: DimensionResult[], complete: boolean, assessable: DimensionKey[]): { points: number; max: number; percent: number | null } {
  const assessed = dims.filter((d) => d.score !== null);
  const points = assessed.reduce((s, d) => s + (d.score as number), 0);
  const counted = complete ? assessed.length : Math.max(assessed.length, assessable.length);
  const max = counted * 3;
  return { points, max, percent: max ? Math.round((points / max) * 100) : null };
}

export const ALL_DIMENSIONS: DimensionKey[] = ['predictionDiscipline', 'retrievalEffort', 'revisionQuality', 'causalCoherence', 'metacognitiveCalibration', 'transfer'];
export const NO_TRANSFER: DimensionKey[] = ALL_DIMENSIONS.filter((k) => k !== 'transfer');
export const BIOLOGY_DIMENSIONS: DimensionKey[] = ['causalCoherence', 'transfer'];
