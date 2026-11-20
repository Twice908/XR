/*
 * Server-side rules for the Human Digestive System journey. The browser receives each checkpoint's question and
 * where to look, plus the answer pools to choose from. The right answers, the expected keywords and the reveal
 * text stay here until the student has committed their own answer for that checkpoint.
 */

export interface Option {
  id: string;
  label: string;
}

export interface Checkpoint {
  id: string;
  organName: string;
  prompt: string;
  modelAnchor: { x: number; y: number; z: number };
  detail: string | null;
  glandsInvolved: string[];
  juicesInvolved: string[];
  componentsInvolved: string[];
  targetNutrient: string;
  answerGlands: string[];
  answerJuices: string[];
  answerComponents: string[];
  answerNutrients: string[];
  revealExplanation: string;
  expectedKeywords: string[];
  keywordSynonyms: Record<string, string[]>;
  [k: string]: unknown;
}

export interface Scenario {
  id: string;
  question: string;
  options: Option[];
  answer: string;
  explanation: string;
}

export interface Selection {
  glands: string[];
  juices: string[];
  components: string[];
  nutrients: string[];
}

export interface Revision {
  text: string;
  coverage: number;
  at: number;
}

export interface Commit {
  checkpoint: string;
  n: number;
  selection: Selection;
  explanation: string;
  confidence: 1 | 2 | 3;
  inputMode: 'voice' | 'typed';
  thinkMs: number;
  speakMs: number;
  committedAt: number;
  selectionScore: { glands: number; juices: number; components: number; nutrients: number; allCorrect: boolean };
  coverage: number;
  matched: string[];
  missed: string[];
  revisions: Revision[];
  audioUrl?: string;
}

export interface FinalResult {
  answers: Record<string, string>;
  results: { id: string; correct: boolean }[];
  correct: number;
  total: number;
  submittedAt: number;
}

export interface BiologyAssignment {
  kind: 'biology';
  lessonId: string;
  studentId: string;
  commits: Record<string, Commit>;
  final: FinalResult | null;
  createdAt: number;
}

/* ---------------- text matching ---------------- */

export const normalizeText = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Very light stemming, enough to treat "absorbs" / "absorbed" / "absorbing" alike. */
export function stem(w: string): string {
  if (w.length <= 4) return w;
  for (const suf of ['ations', 'ation', 'ings', 'ing', 'ies', 'ed', 'es', 's']) {
    if (w.endsWith(suf) && w.length - suf.length >= 4) return w.slice(0, -suf.length);
  }
  return w;
}

const tokens = (s: string) => normalizeText(s).split(' ').filter(Boolean).map(stem);

function containsPhrase(hay: string[], phrase: string[]): boolean {
  if (phrase.length === 0) return false;
  for (let i = 0; i + phrase.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < phrase.length; j++) if (hay[i + j] !== phrase[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}

export function keywordResults(text: string, keywords: string[], synonyms: Record<string, string[]> = {}) {
  const hay = tokens(text);
  const results = keywords.map((k) => ({ keyword: k, matched: [k, ...(synonyms[k] ?? [])].some((v) => containsPhrase(hay, tokens(v))) }));
  const matched = results.filter((r) => r.matched).length;
  return { results, matched: results.filter((r) => r.matched).map((r) => r.keyword), missed: results.filter((r) => !r.matched).map((r) => r.keyword), coverage: keywords.length ? matched / keywords.length : 1 };
}

export const wordCount = (s: string) => normalizeText(s).split(' ').filter(Boolean).length;

/* ---------------- selection scoring ---------------- */

const jaccard = (a: string[], b: string[]) => {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  const inter = [...A].filter((x) => B.has(x)).length;
  return inter / new Set([...A, ...B]).size;
};

export function scoreSelection(cp: Checkpoint, s: Selection) {
  const glands = jaccard(s.glands, cp.answerGlands);
  const juices = jaccard(s.juices, cp.answerJuices);
  const components = jaccard(s.components, cp.answerComponents);
  const nutrients = jaccard(s.nutrients, cp.answerNutrients);
  return { glands, juices, components, nutrients, allCorrect: glands === 1 && juices === 1 && components === 1 && nutrients === 1 };
}

export function cleanSelection(raw: any, choices: { glands: Option[]; juices: Option[]; components: Option[]; nutrients: Option[] }): Selection | null {
  const pick = (v: unknown, pool: Option[]): string[] | null => {
    if (!Array.isArray(v)) return null;
    const ids = new Set(pool.map((o) => o.id));
    const out = [...new Set(v.map(String))].filter((x) => ids.has(x));
    return out.length ? out : null;
  };
  const glands = pick(raw?.glands, choices.glands);
  const juices = pick(raw?.juices, choices.juices);
  const components = pick(raw?.components, choices.components);
  const nutrients = pick(raw?.nutrients, choices.nutrients);
  return glands && juices && components && nutrients ? { glands, juices, components, nutrients } : null;
}

/* ---------------- what the browser may see / what is revealed ---------------- */

export function redactBiology(lesson: any): any {
  return {
    ...lesson,
    checkpoints: lesson.checkpoints.map((c: Checkpoint) => ({
      id: c.id,
      organName: c.organName,
      prompt: c.prompt,
      cameraPosition: c.cameraPosition,
      lookAtTarget: c.lookAtTarget,
      modelAnchor: c.modelAnchor,
      detail: c.detail,
    })),
    transfer: { scenarios: lesson.transfer.scenarios.map((s: Scenario) => ({ id: s.id, question: s.question, options: s.options })) },
  };
}

export function revealFor(cp: Checkpoint, commit: Commit, choices: { glands: Option[]; juices: Option[]; components: Option[]; nutrients: Option[] }) {
  const label = (pool: Option[], id: string) => pool.find((o) => o.id === id)?.label ?? id;
  return {
    checkpoint: cp.id,
    explanation: cp.revealExplanation,
    answer: {
      glands: cp.answerGlands.map((id) => ({ id, label: label(choices.glands, id) })),
      juices: cp.answerJuices.map((id) => ({ id, label: label(choices.juices, id) })),
      components: cp.answerComponents.map((id) => ({ id, label: label(choices.components, id) })),
      nutrients: cp.answerNutrients.map((id) => ({ id, label: label(choices.nutrients, id) })),
      targetNutrient: cp.targetNutrient,
    },
    selectionScore: commit.selectionScore,
    keywords: [...commit.matched.map((k) => ({ keyword: k, matched: true })), ...commit.missed.map((k) => ({ keyword: k, matched: false }))],
    coverage: commit.coverage,
  };
}

export function scoreFinal(scenarios: Scenario[], answers: Record<string, string>) {
  const results = scenarios.map((s) => ({ id: s.id, correct: answers[s.id] === s.answer }));
  return { results, correct: results.filter((r) => r.correct).length, total: scenarios.length };
}

/** Words that would give an unanswered checkpoint away. Used only by the coach's deterministic guard. */
export function secretTerms(cp: Checkpoint): string[] {
  const syn = Object.values(cp.keywordSynonyms ?? {}).flat();
  return [...new Set([...cp.expectedKeywords, ...syn, ...cp.juicesInvolved, ...cp.glandsInvolved, ...(cp.componentsInvolved ?? [])].map((t) => t.replace(/\s*\(.*\)\s*/g, ' ').trim()).filter((t) => t.length >= 3))];
}
