/*
 * Server-side rules for the Human Digestive System journey. The browser receives each checkpoint's question and
 * where to look, plus the answer pools to choose from. The right answers, the expected keywords and the reveal
 * text stay here until the student has committed their own answer for that checkpoint.
 */

export interface Option {
  id: string;
  label: string;
}

/** The question groups a stop asks. A lesson may define its own in `groups`; the digestive lesson uses these. */
export interface Group {
  key: string;
  question: string;
}
export const DEFAULT_GROUPS: Group[] = [
  { key: 'glands', question: 'Which glands act here?' },
  { key: 'juices', question: 'Which digestive juices?' },
  { key: 'components', question: 'Which enzymes or chemicals are in them?' },
  { key: 'nutrients', question: 'Which nutrients are being worked on?' },
];
export const groupsOf = (lesson: { groups?: Group[] }): Group[] => (lesson.groups?.length ? lesson.groups : DEFAULT_GROUPS);
const cap = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);

export interface Choices {
  [group: string]: Option[];
}

export interface Checkpoint {
  id: string;
  organName: string;
  prompt: string;
  modelAnchor: { x: number; y: number; z: number };
  detail: string | null;
  /** The right answer ids per group (new lessons). Older lessons use answerGlands, answerJuices ... */
  answers?: Record<string, string[]>;
  /** A short phrase for what this stop is about, shown with the reveal. */
  target?: string;
  targetNutrient?: string;
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

export type Selection = Record<string, string[]>;

/** Right answers for one group, from either shape of lesson data. */
export function answerIds(cp: Checkpoint, key: string): string[] {
  const direct = cp.answers?.[key];
  if (direct) return direct;
  const legacy = cp[`answer${cap(key)}`];
  return Array.isArray(legacy) ? (legacy as string[]) : [];
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
  selectionScore: SelectionScore;
  coverage: number;
  matched: string[];
  missed: string[];
  revisions: Revision[];
  audioUrl?: string;
}

export type SelectionScore = { allCorrect: boolean } & Record<string, number | boolean>;

export interface FinalExplain {
  text: string;
  coverage: number;
  matched: string[];
  missed: string[];
  inputMode: 'voice' | 'typed';
  speakMs: number;
}

export interface FinalResult {
  explain?: FinalExplain;
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

export function scoreSelection(cp: Checkpoint, s: Selection, groups: Group[] = DEFAULT_GROUPS): SelectionScore {
  const out: Record<string, number | boolean> = {};
  let all = true;
  for (const g of groups) {
    const score = jaccard(s[g.key] ?? [], answerIds(cp, g.key));
    out[g.key] = score;
    if (score !== 1) all = false;
  }
  return { ...out, allCorrect: all };
}

export function cleanSelection(raw: any, choices: Choices, groups: Group[] = DEFAULT_GROUPS): Selection | null {
  const out: Selection = {};
  for (const g of groups) {
    const v = raw?.[g.key];
    if (!Array.isArray(v)) return null;
    const ids = new Set((choices[g.key] ?? []).map((o) => o.id));
    const picked = [...new Set(v.map(String))].filter((x) => ids.has(x));
    if (!picked.length) return null;
    out[g.key] = picked;
  }
  return out;
}

/* ---------------- what the browser may see / what is revealed ---------------- */

export function redactBiology(lesson: any): any {
  return {
    ...lesson,
    groups: groupsOf(lesson),
    ...(lesson.finalExplain ? { finalExplain: { prompt: lesson.finalExplain.prompt, minWords: lesson.finalExplain.minWords ?? 20 } } : {}),
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

export function revealFor(cp: Checkpoint, commit: Commit, choices: Choices, groups: Group[] = DEFAULT_GROUPS) {
  const label = (pool: Option[], id: string) => pool.find((o) => o.id === id)?.label ?? id;
  const answer: Record<string, unknown> = {};
  for (const g of groups) answer[g.key] = answerIds(cp, g.key).map((id) => ({ id, label: label(choices[g.key] ?? [], id) }));
  return {
    checkpoint: cp.id,
    explanation: cp.revealExplanation,
    answer: { ...answer, targetNutrient: cp.target ?? cp.targetNutrient ?? '' },
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
  const involved = Object.entries(cp)
    .filter(([k, v]) => k.endsWith('Involved') && Array.isArray(v))
    .flatMap(([, v]) => v as string[]);
  return [...new Set([...cp.expectedKeywords, ...syn, ...involved].map((t) => t.replace(/\s*\(.*\)\s*/g, ' ').trim()).filter((t) => t.length >= 3))];
}
