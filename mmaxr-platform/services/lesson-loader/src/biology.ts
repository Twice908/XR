/*
 * Server-side rules for the biology journeys (digestive and respiratory systems).
 *
 * The student first walks a view-only tour: each organ comes with its explanation and animation. Afterwards a
 * short quiz is dealt from per-organ question pools (a few questions, one shown at a time, at most four options,
 * everything shuffled per session). Right answers stay here; the browser sees a question's wording and its options
 * in the order dealt, under opaque ids, and learns the right answer only after answering that question.
 * A closing spoken or typed explanation keeps the key-ideas coverage scoring.
 */
import { dealOptions, pickIndex, sample, shuffle, type Rand } from './questionEngine';

export interface Option {
  id: string;
  label: string;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  /** The first option is not special: ids are neutral and the order is dealt per session. */
  options: Option[];
  answer: string;
  explanation: string;
}

export interface Checkpoint {
  id: string;
  organName: string;
  modelAnchor: { x: number; y: number; z: number };
  detail: string | null;
  /** What the tour teaches at this stop. Public: the tour is for learning, the quiz comes afterwards. */
  explanation: string;
  /** Names floated over the animation. Public. */
  animLabels: string[];
  /** The pool this stop's quiz question is drawn from. Never sent to the browser. */
  quiz: QuizQuestion[];
  [k: string]: unknown;
}

/** One dealt question: which organ, which variant of its pool, and the order its options are shown in. */
export interface QuizDeal {
  cp: string;
  qid: string;
  order: string[];
}

export interface QuizAnswer {
  qid: string;
  /** The option's id in the contract (not the opaque id the browser used). */
  choice: string;
  correct: boolean;
  thinkMs: number;
  at: number;
}

export interface FinalExplain {
  text: string;
  coverage: number;
  matched: string[];
  missed: string[];
  /** Some sentences were key-word lists and did not count. */
  listLike?: boolean;
  inputMode: 'voice' | 'typed';
  speakMs: number;
}

export interface FinalResult {
  explain?: FinalExplain;
  correct: number;
  total: number;
  submittedAt: number;
  audioUrl?: string;
}

export interface BiologyAssignment {
  kind: 'biology';
  lessonId: string;
  studentId: string;
  /** Checkpoint ids the student has walked through, in order. */
  visited: string[];
  /** Checkpoint ids whose animation the student has watched. A stop cannot be left until it is in here. */
  watched?: string[];
  /** When the student arrived at the current stop (the journey start for stop 1). */
  arrivedAt?: number;
  quiz: QuizDeal[];
  answers: Record<string, QuizAnswer>;
  final: FinalResult | null;
  createdAt: number;
}

/* ---------------- dealing the quiz ---------------- */

/**
 * Deals `count` questions from `count` different organs, each from that organ's pool, with options in a fresh order.
 * `seen` (question ids from earlier attempts) are avoided while any unseen variant is left in the pool.
 */
export function dealQuiz(lesson: { checkpoints: Checkpoint[]; config?: { quizSize?: number } }, rand: Rand = Math.random, seen: ReadonlySet<string> = new Set()): QuizDeal[] {
  const count = Math.min(lesson.config?.quizSize ?? 3, lesson.checkpoints.length);
  const organs = sample(lesson.checkpoints, count, rand);
  const out: QuizDeal[] = [];
  let lastSlot: number | undefined;
  for (const cp of organs) {
    const fresh = cp.quiz.filter((q) => !seen.has(q.id));
    const pool = fresh.length ? fresh : cp.quiz;
    const q = pool[pickIndex(pool.length, rand)];
    const order = dealOptions(q.options.map((o) => o.id), rand, q.answer, lastSlot);
    lastSlot = order.indexOf(q.answer);
    out.push({ cp: cp.id, qid: q.id, order });
  }
  return shuffle(out, rand);
}

export const questionOf = (lesson: { checkpoints: Checkpoint[] }, deal: QuizDeal): QuizQuestion | undefined => lesson.checkpoints.find((c) => c.id === deal.cp)?.quiz.find((q) => q.id === deal.qid);

/** Opaque option id the browser uses: its position in the dealt order. */
export const posId = (i: number) => `p${i}`;

/** The dealt questions as the browser may see them: wording and options only. */
export function quizFor(lesson: { checkpoints: Checkpoint[] }, a: Pick<BiologyAssignment, 'quiz'>) {
  return a.quiz.flatMap((d) => {
    const q = questionOf(lesson, d);
    const cp = lesson.checkpoints.find((c) => c.id === d.cp);
    if (!q || !cp) return [];
    return [{ id: q.id, organ: cp.organName, prompt: q.prompt, options: d.order.map((id, i) => ({ id: posId(i), label: q.options.find((o) => o.id === id)?.label ?? '' })) }];
  });
}

/** Marks one answer. `pick` is the opaque position id the browser sent. Null when it does not fit the question. */
export function markAnswer(lesson: { checkpoints: Checkpoint[] }, a: Pick<BiologyAssignment, 'quiz'>, qid: string, pick: string) {
  const d = a.quiz.find((x) => x.qid === qid);
  const q = d && questionOf(lesson, d);
  if (!d || !q) return null;
  const at = /^p([0-3])$/.exec(pick);
  const choice = at ? d.order[Number(at[1])] : undefined;
  if (choice === undefined) return null;
  return { choice, correct: choice === q.answer, answerPos: posId(d.order.indexOf(q.answer)), explanation: q.explanation };
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

/**
 * Words that tie ideas together in a sentence. A keyword only counts when its sentence has one of these: a bare list of
 * organ names says nothing about how they connect.
 */
const LINK_WORDS = new Set(
  'is are was were be it its they them this that these those so because then into through to from by with where which when while as and carries carry carried moves move moved passes pass passed goes go travels travel enters enter leaves leave pushes push pulls pull breaks break turns turn makes make takes take absorbs absorb releases release sends send helps help happens after before until'
    .split(' ')
    .map(stem),
);

/**
 * Key-idea coverage of a written or spoken explanation. Unlike `keywordResults`, a keyword only counts inside a real
 * sentence: at least 5 words, at least one linking word, and no more than half of its words being key terms. This stops
 * a list of key words ("nose pharynx larynx trachea ...") from scoring as a full explanation.
 */
export function explanationResults(text: string, keywords: string[], synonyms: Record<string, string[]> = {}) {
  const sentences = text
    .split(/[.!?;:\n]+/)
    .map((x) => tokens(x))
    .filter((t) => t.length > 0);
  const phrases = keywords.map((k) => [k, ...(synonyms[k] ?? [])].map((v) => tokens(v)).filter((p) => p.length > 0));
  const keyTokens = new Set(phrases.flat(2));
  const usable = sentences.filter((t) => t.length >= 5 && t.some((w) => LINK_WORDS.has(w)) && t.filter((w) => keyTokens.has(w)).length / t.length <= 0.5);
  const results = keywords.map((k, i) => ({ keyword: k, matched: usable.some((t) => phrases[i].some((p) => containsPhrase(t, p))) }));
  const matched = results.filter((r) => r.matched).length;
  return {
    results,
    matched: results.filter((r) => r.matched).map((r) => r.keyword),
    missed: results.filter((r) => !r.matched).map((r) => r.keyword),
    coverage: keywords.length ? matched / keywords.length : 1,
    /** True when some sentences were ignored because they were word lists rather than explanations. */
    listLike: usable.length < sentences.length,
  };
}

export const wordCount = (s: string) => normalizeText(s).split(' ').filter(Boolean).length;

/* ---------------- what the browser may see ---------------- */

export function redactBiology(lesson: any): any {
  return {
    ...lesson,
    ...(lesson.finalExplain ? { finalExplain: { prompt: lesson.finalExplain.prompt, minWords: lesson.finalExplain.minWords ?? 20 } } : {}),
    checkpoints: lesson.checkpoints.map((c: Checkpoint) => ({
      id: c.id,
      organName: c.organName,
      cameraPosition: c.cameraPosition,
      lookAtTarget: c.lookAtTarget,
      modelAnchor: c.modelAnchor,
      detail: c.detail,
      explanation: c.explanation,
      animLabels: c.animLabels,
    })),
  };
}

/** Words that would give an unanswered quiz question away: its right answer. Used only by the coach's deterministic guard. */
export function secretTerms(q: QuizQuestion): string[] {
  const label = q.options.find((o) => o.id === q.answer)?.label ?? '';
  return label.length >= 3 ? [label] : [];
}
