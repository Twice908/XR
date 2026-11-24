/*
 * Server-side rules for the chemistry indicators lab. The client never receives a tube's identity,
 * type or pH, nor an indicator's acid/base colours: it asks the server what a test shows.
 */

export type Verdict = 'acid' | 'base' | 'neutral';

export interface Solution {
  id: string;
  name: string;
  formula: string;
  type: string;
  ph: number;
}

export interface Indicator {
  id: string;
  name: string;
  source: string;
  isPhTest?: boolean;
  colors?: { neutral?: string; acid?: string; base?: string };
}

export interface Submission {
  tubes: { tube: number; conclusion: Verdict | null; ph: number | null; conclusionHistory: Verdict[] }[];
  submittedAt: number;
}

export interface Assignment {
  lessonId: string;
  studentId: string;
  tubes: Solution[];
  /** "tube:tool" -> colour already shown, so repeating a test cannot be used to probe. */
  tested: Record<string, string>;
  submission: Submission | null;
  createdAt: number;
}

export function verdictOf(type: string): Verdict {
  const t = (type ?? '').toLowerCase();
  if (t.includes('acid')) return 'acid';
  if (t.includes('base') || t.includes('alkal')) return 'base';
  return 'neutral';
}

export function phPaperColor(ph: number): string {
  if (ph <= 2) return 'Red';
  if (ph <= 4) return 'Orange';
  if (ph <= 6) return 'Yellow';
  if (ph <= 7) return 'Green';
  if (ph <= 10) return 'Blue';
  return 'Purple';
}

export function reactionColor(indicators: Indicator[], solution: Solution, toolId: string): string | null {
  const ind = indicators.find((i) => i.id === toolId);
  if (!ind) return null;
  if (ind.isPhTest) return phPaperColor(solution.ph);
  return ind.colors?.[verdictOf(solution.type)] ?? null;
}

/** Fisher-Yates over a copy; `rand` is injectable for tests. */
export function pickSolutions(pool: Solution[], count: number, rand: () => number = Math.random): Solution[] {
  const a = [...pool];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, count);
}

/** The lesson as the browser may see it: no solution pool, no assignment, only the neutral colour of each indicator. */
export function redactChemistry(lesson: any): any {
  const { solutionPool: _pool, assignedSolutions: _assigned, ...rest } = lesson;
  return {
    ...rest,
    indicators: (lesson.indicators ?? []).map((i: Indicator) => (i.isPhTest ? { ...i, colors: undefined } : { ...i, colors: { neutral: i.colors?.neutral } })),
  };
}

export const isVerdict = (v: unknown): v is Verdict => v === 'acid' || v === 'base' || v === 'neutral';
