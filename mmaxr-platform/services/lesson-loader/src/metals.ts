/*
 * Server-side rules for the Metals & Non-Metals lab. The browser sees how each sample LOOKS (colour, state,
 * lustre) and the tools available, but never what a sample is, its type, or what a test will show.
 */

export type Kind = 'metal' | 'non-metal';

export interface Appearance {
  color: string;
  colorHex: string;
  state: 'solid' | 'liquid';
  lustre: 'shiny' | 'dull';
  texture: string;
}

export interface Material {
  id: string;
  name: string;
  formula: string;
  trueType: Kind;
  anomalyFlag?: boolean;
  appearance: Appearance;
  results: Record<string, string>;
  oxideLitmus: string;
  why?: string;
}

export interface MetalsSubmission {
  samples: { sample: number; conclusion: Kind | null; hypothesis: Kind | null; conclusionHistory: Kind[] }[];
  submittedAt: number;
}

export interface MetalsAssignment {
  kind: 'metals';
  lessonId: string;
  studentId: string;
  samples: Material[];
  /** "slot:tool" -> outcome already shown (repeats are free and identical). */
  tested: Record<string, string>;
  submission: MetalsSubmission | null;
  createdAt: number;
}

export const isKind = (v: unknown): v is Kind => v === 'metal' || v === 'non-metal';

/**
 * Draw the samples for one session: at least `minAnomalies` exceptions, and a mix that is never all one type
 * (2 to count-2 metals), so a student cannot guess the whole table from one rule.
 */
import { shuffle } from './questionEngine';

export function pickMaterials(pool: Material[], count: number, minAnomalies: number, rand: () => number = Math.random): Material[] {
  const shuf = <T>(xs: T[]) => shuffle(xs, rand);
  const anomalies = pool.filter((m) => m.anomalyFlag);
  const rest = pool.filter((m) => !m.anomalyFlag);
  for (let attempt = 0; attempt < 300; attempt++) {
    const chosen = [...shuf(anomalies).slice(0, Math.min(minAnomalies, anomalies.length))];
    const ids = new Set(chosen.map((m) => m.id));
    for (const m of shuf(pool)) {
      if (chosen.length >= count) break;
      if (!ids.has(m.id)) {
        chosen.push(m);
        ids.add(m.id);
      }
    }
    const metals = chosen.filter((m) => m.trueType === 'metal').length;
    if (chosen.length === count && metals >= 2 && metals <= count - 2) return shuf(chosen);
  }
  return shuf(pool).slice(0, count); // pool too small to satisfy the mix; still valid
}

export interface TestOutcome {
  outcome: string;
  /** Only the oxygen test: what litmus did with the oxide that formed. */
  litmus?: string;
}

export function runTest(m: Material, toolId: string): TestOutcome | null {
  const outcome = m.results[toolId];
  if (!outcome) return null;
  return toolId === 'oxygen' ? { outcome, litmus: m.oxideLitmus } : { outcome };
}

/** The lesson as the browser may see it: tools and rules, no material pool and no results. */
export function redactMetals(lesson: any): any {
  const { materialPool: _pool, ...rest } = lesson;
  return rest;
}

/** What the student may see of each sample before any test: looks only. */
export function visibleSamples(samples: Material[]) {
  return samples.map((m, i) => ({ slot: i + 1, ...m.appearance }));
}

export function budgetUsed(a: MetalsAssignment): number {
  return Object.keys(a.tested).length;
}

/** Plain-language facts for the coach's wrap-up (only ever used after submission). */
export function factsFor(m: Material): string {
  const r = m.results;
  const bits = [
    `hammer: ${r.hammer}`,
    `wire: ${r.wire}`,
    `tap: ${r.tap}`,
    `electricity: ${r.circuit}`,
    `heat: ${r.heat}`,
    `oxygen: ${r.oxygen}`,
    `water: ${r.water}`,
  ].join(', ');
  return `${bits}. ${m.why ?? ''}`.trim();
}
