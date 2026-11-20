import { keywordResults, wordCount } from './biology';

/*
 * Motion, Forces & Gravitation: pure logic. Answers, tolerances, outcomes and explanations live only in the lesson
 * file on the server; the browser gets the questions and the input shape, and learns the answer trial by trial.
 */

export interface MotionTrial {
  id: string;
  kind: 'prediction' | 'transfer';
  anomaly: boolean;
  action: string | null;
  prompt: string;
  input: { type: 'numeric'; fields: { id: string; label: string; unit: string }[] } | { type: 'choice'; options: { id: string; label: string }[] };
  answer: Record<string, number | string>;
  tolerance?: number | Record<string, number>;
  outcome: string;
  explanation: string;
  expectedKeywords?: string[];
  keywordSynonyms?: Record<string, string[]>;
  coachSecrets?: string[];
  /** The law this question is about. Held back until the result has been watched, so it cannot hint at the answer. */
  law?: { name: string; formula?: string };
  /** Simulation settings for the default values (mass, force, distance…). Public: they only drive the animation. */
  params?: Record<string, unknown>;
  /** Alternative sets of values for this question. One is drawn for each session, so repeat attempts differ. */
  variants?: Partial<Omit<MotionTrial, 'id' | 'kind' | 'anomaly' | 'action' | 'variants'>>[];
}
export interface MotionScenario {
  id: string;
  tabName: string;
  title: string;
  setup: string;
  trials: MotionTrial[];
}

export interface MotionPrediction {
  trial: string;
  value: Record<string, number | string>;
  confidence: 1 | 2 | 3;
  thinkMs: number;
  at: number;
  /** Set once the student has watched the result. */
  match: boolean | null;
  fieldMatch: Record<string, boolean> | null;
  explanation?: { text: string; coverage: number; matched: string[]; missed: string[]; words: number; at: number; inputMode?: 'voice' | 'typed'; speakMs?: number; audioUrl?: string };
}
export interface MotionAssignment {
  kind: 'motion';
  lessonId: string;
  studentId: string;
  predictions: Record<string, MotionPrediction>;
  /** Which set of values this session got for each question (index into `variants`). Missing = the default values. */
  variants?: Record<string, number>;
  /** The order this session sees each multiple-choice question's options in. */
  orders?: Record<string, string[]>;
  createdAt: number;
}

/** The question with the values this session was dealt. */
export function resolveTrial(t: MotionTrial, idx: number | undefined): MotionTrial {
  const v = idx !== undefined && t.variants ? t.variants[idx] : undefined;
  if (!v) return t;
  return { ...t, ...v, coachSecrets: v.coachSecrets ?? [], params: v.params ?? t.params };
}

const shuffled = <T,>(xs: T[], rnd: () => number): T[] => {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/** Deals this session its values and its option order for every question, like drawing samples for the test tubes. */
export function drawVariants(lesson: { scenarios: MotionScenario[] }, rnd: () => number = Math.random): Pick<MotionAssignment, 'variants' | 'orders'> {
  const variants: Record<string, number> = {};
  const orders: Record<string, string[]> = {};
  for (const t of lesson.scenarios.flatMap((s) => s.trials)) {
    const n = t.variants?.length ?? 0;
    const idx = n > 1 ? Math.floor(rnd() * n) : 0;
    if (n > 0) variants[t.id] = idx;
    const r = resolveTrial(t, idx);
    if (r.input.type === 'choice') orders[t.id] = shuffled(r.input.options.map((o) => o.id), rnd);
  }
  return { variants, orders };
}

export const trialOf = (t: MotionTrial, a: Pick<MotionAssignment, 'variants'> | null | undefined): MotionTrial => resolveTrial(t, a?.variants?.[t.id]);

const inOrder = (input: MotionTrial['input'], order: string[] | undefined): MotionTrial['input'] => {
  if (input.type !== 'choice' || !order) return input;
  const rank = new Map(order.map((id, i) => [id, i]));
  return { type: 'choice', options: [...input.options].sort((x, y) => (rank.get(x.id) ?? 99) - (rank.get(y.id) ?? 99)) };
};

export const allTrials = (lesson: { scenarios: MotionScenario[] }): MotionTrial[] => lesson.scenarios.flatMap((s) => s.trials);

/** What the browser may see: no answers, outcomes, explanations, keywords or coach secrets. */
export function redactMotion(lesson: any, a?: Pick<MotionAssignment, 'variants' | 'orders'> | null): any {
  const { laws: _laws, ...rest } = lesson;
  void _laws;
  return {
    ...rest,
    scenarios: lesson.scenarios.map((s: MotionScenario) => ({
      id: s.id,
      tabName: s.tabName,
      title: s.title,
      setup: s.setup,
      trials: s.trials.map((base) => {
        const t = trialOf(base, a);
        return { id: t.id, kind: t.kind, anomaly: t.anomaly, action: t.action, prompt: t.prompt, input: inOrder(t.input, a?.orders?.[t.id]), params: t.params ?? {}, needsExplanation: t.anomaly && (t.expectedKeywords?.length ?? 0) > 0 };
      }),
    })),
  };
}

/** Validates the prediction's shape against the trial's input. Returns the cleaned value or null. */
export function cleanPrediction(t: MotionTrial, raw: any): Record<string, number | string> | null {
  if (!raw || typeof raw !== 'object') return null;
  if (t.input.type === 'choice') {
    const c = String(raw.choice ?? '');
    return t.input.options.some((o) => o.id === c) ? { choice: c } : null;
  }
  const out: Record<string, number> = {};
  for (const f of t.input.fields) {
    const v = typeof raw[f.id] === 'number' ? raw[f.id] : Number.NaN;
    if (!Number.isFinite(v) || Math.abs(v) > 1e6) return null;
    out[f.id] = v;
  }
  return out;
}

export function scorePrediction(t: MotionTrial, value: Record<string, number | string>) {
  const fieldMatch: Record<string, boolean> = {};
  if (t.input.type === 'choice') fieldMatch.choice = value.choice === t.answer.choice;
  else
    for (const f of t.input.fields) {
      const tol = typeof t.tolerance === 'number' ? t.tolerance : t.tolerance?.[f.id] ?? 0;
      fieldMatch[f.id] = Math.abs(Number(value[f.id]) - Number(t.answer[f.id])) <= tol;
    }
  return { match: Object.values(fieldMatch).every(Boolean), fieldMatch };
}

/** Everything the student may learn once they have locked a prediction and watched the result. */
export function observeFor(t: MotionTrial, p: MotionPrediction) {
  return {
    trial: t.id,
    match: p.match === true,
    fieldMatch: p.fieldMatch ?? {},
    answer: t.answer,
    outcome: t.outcome,
    law: t.law ?? null,
    // Anomalies keep their explanation back until the student has tried to explain.
    explanation: t.anomaly && t.expectedKeywords?.length && !p.explanation ? null : t.explanation,
  };
}

export function scoreExplanation(t: MotionTrial, text: string) {
  const kw = keywordResults(text, t.expectedKeywords ?? [], t.keywordSynonyms);
  return { ...kw, words: wordCount(text) };
}

/** Phrases the coach must never say before the trial is observed. */
export function secretsOf(t: MotionTrial): string[] {
  const answers = t.input.type === 'choice' ? [t.input.options.find((o) => o.id === t.answer.choice)?.label ?? ''] : [];
  return [...new Set([...(t.coachSecrets ?? []), ...answers].map((s) => s.trim()).filter((s) => s.length >= 3))];
}
