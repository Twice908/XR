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
  createdAt: number;
}

export const allTrials = (lesson: { scenarios: MotionScenario[] }): MotionTrial[] => lesson.scenarios.flatMap((s) => s.trials);

/** What the browser may see: no answers, outcomes, explanations, keywords or coach secrets. */
export function redactMotion(lesson: any): any {
  const { laws: _laws, ...rest } = lesson;
  void _laws;
  return {
    ...rest,
    scenarios: lesson.scenarios.map((s: MotionScenario) => ({
      id: s.id,
      tabName: s.tabName,
      title: s.title,
      setup: s.setup,
      trials: s.trials.map((t) => ({ id: t.id, kind: t.kind, anomaly: t.anomaly, action: t.action, prompt: t.prompt, input: t.input, needsExplanation: t.anomaly && (t.expectedKeywords?.length ?? 0) > 0 })),
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
