/*
 * Server-side rules for the Light: Reflection & Spherical Mirrors lab.
 *
 * Two things keep this lab about the process of finding things out rather than about looking an answer up:
 *  1. Every session gets its own run of the experiment (`OpticsPlan`): the angles, offsets and candle distances are
 *     drawn from pools, the order of the laws, rules and positions is shuffled, and the answer options of every
 *     question are put in a different order. An answer copied from somewhere else does not fit this session.
 *  2. Nothing is disclosed before the student has committed to a prediction, and no run is complete until the student
 *     has explained it, in their own words and using the numbers from their own run.
 * The browser only ever receives the personalised lesson with every answer, anchor and explanation removed.
 */
import type { OpticsImage, OpticsImageField, OpticsLessonContract, OpticsMirror, OpticsOption, OpticsRevealCase, OpticsReveal, OpticsTrialKind, OpticsTrialResult } from '@mmaxr/schema';

export const IMAGE_FIELDS: OpticsImageField[] = ['position', 'size', 'nature', 'orientation'];

export interface Explanation {
  text: string;
  inputMode: 'voice' | 'typed';
  speakMs: number;
  /** Time the student spent thinking, as the browser measured it. */
  thinkMs: number;
  /** Time between the result being shown and the explanation arriving, as the server measured it. */
  dwellMs: number;
  /** How many characters were pasted into the box, and how many times the student left the tab meanwhile. */
  pasted: number;
  blurs: number;
  words: number;
  at: number;
  audioUrl?: string;
}

export interface OpticsTrial {
  kind: OpticsTrialKind;
  id: string;
  /** plane / law / rule: `{ outcome }`. case: the four image fields. */
  prediction: Record<string, string>;
  confidence: 1 | 2 | 3;
  thinkMs: number;
  at: number;
  /** When the result was handed to the browser: explanations are timed from here. */
  resultAt: number;
  match: boolean;
  /** Number of correct image fields (cases only). */
  score: number;
  explanation?: Explanation;
}

export interface OpticsSubmission {
  table: Record<string, OpticsImage>;
  notes: Record<string, string>;
  submittedAt: number;
}

export interface OpticsPlan {
  surfaceOrder: string[];
  planeOptionOrder: string[];
  laws: { id: string; variant: number; side: 'left' | 'right'; optionOrder: string[] }[];
  rules: { id: string; variant: number; where: 'above' | 'below'; optionOrder: string[] }[];
  caseOrder: { concave: string[]; convex: string[] };
  /** Object distance (in focal lengths) drawn for the cases that sit inside a zone rather than on a point. */
  uOverF: Record<string, number>;
  fieldOrder: Record<OpticsImageField, string[]>;
}

export interface OpticsAssignment {
  kind: 'optics';
  lessonId: string;
  studentId: string;
  plan: OpticsPlan;
  trials: Record<string, OpticsTrial>;
  submission: OpticsSubmission | null;
  createdAt: number;
}

export interface FlatCase {
  id: string;
  mirror: OpticsMirror;
  objectPosition: string;
  expected: OpticsImage;
  anomaly: boolean;
  anomalyExplanation: string;
}

type Rand = () => number;

/* ---------------------------------------------------------------- per-session plan */

function shuffle<T>(xs: T[], rand: Rand): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const pick = (n: number, rand: Rand) => Math.floor(rand() * n);
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

/** Where a candle may sit inside its zone without changing what the textbook says about the image. */
const ZONES: Record<string, [number, number]> = {
  concave_beyond_c: [2.6, 4],
  concave_between_c_f: [1.25, 1.75],
  concave_between_f_p: [0.35, 0.75],
  convex_between_p_infinity: [1.5, 4],
};

export function makePlan(lesson: OpticsLessonContract, rand: Rand = Math.random): OpticsPlan {
  const concave = lesson.sphericalMirrors.find((m) => m.mirrorType === 'concave')!.cases;
  const convex = lesson.sphericalMirrors.find((m) => m.mirrorType === 'convex')!.cases;
  const uOverF: Record<string, number> = {};
  for (const [id, [lo, hi]] of Object.entries(ZONES)) uOverF[id] = Math.round((lo + rand() * (hi - lo)) * 100) / 100;
  return {
    surfaceOrder: shuffle(ids(lesson.planeMirror.scenarios), rand),
    planeOptionOrder: shuffle(ids(lesson.planeMirror.predictionOptions), rand),
    laws: shuffle(lesson.lawsOfReflection.laws, rand).map((l) => ({ id: l.id, variant: pick(l.variants?.length ?? 1, rand), side: rand() < 0.5 ? ('left' as const) : ('right' as const), optionOrder: shuffle(ids(l.options), rand) })),
    rules: shuffle(lesson.rayRules.rules, rand).map((r) => ({ id: r.id, variant: pick(r.variants?.length ?? 1, rand), where: rand() < 0.5 ? ('above' as const) : ('below' as const), optionOrder: shuffle(ids(lesson.rayRules.outcomes), rand) })),
    caseOrder: { concave: shuffle(ids(concave), rand), convex: shuffle(ids(convex), rand) },
    uOverF,
    fieldOrder: Object.fromEntries(IMAGE_FIELDS.map((f) => [f, shuffle(ids(lesson.imageFields[f]), rand)])) as OpticsPlan['fieldOrder'],
  };
}

const order = <T extends { id: string }>(xs: T[], by: string[]) => by.map((id) => xs.find((x) => x.id === id)).filter((x): x is T => !!x);
const fill = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));

/** The lesson as this session runs it: values drawn, everything in its shuffled order. Still holds the answers. */
export function personalize(lesson: OpticsLessonContract, plan: OpticsPlan): OpticsLessonContract {
  const out: OpticsLessonContract = JSON.parse(JSON.stringify(lesson));
  out.planeMirror.scenarios = order(out.planeMirror.scenarios, plan.surfaceOrder);
  out.planeMirror.predictionOptions = order(out.planeMirror.predictionOptions, plan.planeOptionOrder);

  out.lawsOfReflection.laws = plan.laws.map((p) => {
    const l = out.lawsOfReflection.laws.find((x) => x.id === p.id)!;
    const v = l.variants?.[p.variant] ?? { i: 40, e: 0 };
    const vars = { i: v.i, e: v.e, side: p.side, c: 90 - v.i, p: v.i + 20, m: v.i - 18 };
    const options = order(l.options, p.optionOrder).map((o) => ({ ...o, label: fill(o.label, vars) }));
    const { variants: _v, ...rest } = l;
    return { ...rest, incidentAngleDeg: v.i, elevationDeg: v.e, side: p.side, incident: fill(l.incident, vars), options, statement: l.statement, explanation: l.explanation && fill(l.explanation, vars), anchors: l.anchors?.map((g) => g.map((t) => fill(t, vars))) };
  });

  out.rayRules.rules = plan.rules.map((p) => {
    const r = out.rayRules.rules.find((x) => x.id === p.id)!;
    const v = r.variants?.[p.variant] ?? { n: 8 };
    const vars = { n: v.n, where: p.where };
    const { variants: _v, ...rest } = r;
    return { ...rest, params: { n: v.n, where: p.where }, incident: fill(r.incident, vars), anchors: r.anchors?.map((g) => g.map((t) => fill(t, vars))), options: order(out.rayRules.outcomes, p.optionOrder) } as typeof r & { options: OpticsOption[] };
  });

  for (const m of out.sphericalMirrors) {
    m.cases = order(m.cases, m.mirrorType === 'concave' ? plan.caseOrder.concave : plan.caseOrder.convex).map((c) => (plan.uOverF[c.id] !== undefined ? { ...c, uOverF: plan.uOverF[c.id] } : c));
  }
  for (const f of IMAGE_FIELDS) out.imageFields[f] = order(out.imageFields[f], plan.fieldOrder[f]);
  return out;
}

/** The lesson as the browser may see it: no outcome, expected image, anomaly flag, rule text, anchor or use. */
export function redactOptics(lesson: any): any {
  const { uses: _uses, ...rest } = lesson;
  return {
    ...rest,
    planeMirror: { ...lesson.planeMirror, scenarios: lesson.planeMirror.scenarios.map(({ result: _r, explanation: _e, anchors: _a, ...s }: any) => s) },
    lawsOfReflection: { laws: lesson.lawsOfReflection.laws.map(({ answer: _a, statement: _s, explanation: _e, anchors: _n, variants: _v, ...l }: any) => l) },
    rayRules: { ...lesson.rayRules, rules: lesson.rayRules.rules.map(({ reflected: _r, explanation: _e, description: _d, anchors: _a, variants: _v, ...r }: any) => r) },
    sphericalMirrors: lesson.sphericalMirrors.map((m: any) => ({ ...m, cases: m.cases.map(({ expectedImage: _i, isAnomaly: _a, anomalyExplanation: _x, ...c }: any) => c) })),
  };
}

/* ---------------------------------------------------------------- lookups */

/** Every spherical-mirror case in lesson order: concave first, then convex. */
export function flatCases(lesson: OpticsLessonContract): FlatCase[] {
  return lesson.sphericalMirrors.flatMap((m) =>
    m.cases.map((c) => ({ id: c.id, mirror: m.mirrorType, objectPosition: c.objectPosition, expected: c.expectedImage as OpticsImage, anomaly: c.isAnomaly === true, anomalyExplanation: c.anomalyExplanation ?? '' })),
  );
}

export const trialKey = (kind: OpticsTrialKind, id: string) => `${kind}:${id}`;

/** Keep only a well-formed image whose every field is one of the lesson's options. */
export function cleanImage(raw: unknown, lesson: OpticsLessonContract): OpticsImage | null {
  if (!raw || typeof raw !== 'object') return null;
  const out = {} as OpticsImage;
  for (const f of IMAGE_FIELDS) {
    const v = (raw as Record<string, unknown>)[f];
    if (typeof v !== 'string' || !lesson.imageFields[f].some((o) => o.id === v)) return null;
    out[f] = v;
  }
  return out;
}

export function compareImage(expected: OpticsImage, got: OpticsImage | null): Record<OpticsImageField, boolean> {
  const r = {} as Record<OpticsImageField, boolean>;
  for (const f of IMAGE_FIELDS) r[f] = got !== null && got[f] === expected[f];
  return r;
}

const countTrue = (r: Record<string, boolean>) => Object.values(r).filter(Boolean).length;

/** Judge one trial. Returns null when the id is unknown or the prediction is malformed. */
export function judgeTrial(lesson: OpticsLessonContract, kind: OpticsTrialKind, id: string, prediction: unknown): { result: OpticsTrialResult; stored: Record<string, string>; score: number } | null {
  const outcome = (prediction as { outcome?: unknown } | null)?.outcome;
  if (kind === 'plane') {
    const s = lesson.planeMirror.scenarios.find((x) => x.id === id);
    if (!s || typeof outcome !== 'string' || !lesson.planeMirror.predictionOptions.some((o) => o.id === outcome)) return null;
    const match = outcome === s.result;
    return { result: { kind, id, match, outcome: s.result, explanation: s.explanation ?? '' }, stored: { outcome }, score: match ? 1 : 0 };
  }
  if (kind === 'law') {
    const l = lesson.lawsOfReflection.laws.find((x) => x.id === id);
    if (!l || typeof outcome !== 'string' || !l.options.some((o) => o.id === outcome)) return null;
    const match = outcome === l.answer;
    return { result: { kind, id, match, outcome: l.answer, explanation: l.explanation ?? l.statement ?? '' }, stored: { outcome }, score: match ? 1 : 0 };
  }
  if (kind === 'rule') {
    const r = lesson.rayRules.rules.find((x) => x.id === id);
    if (!r || typeof outcome !== 'string' || !lesson.rayRules.outcomes.some((o) => o.id === outcome)) return null;
    const match = outcome === r.reflected;
    return { result: { kind, id, match, outcome: r.reflected, explanation: r.explanation ?? r.description }, stored: { outcome }, score: match ? 1 : 0 };
  }
  const c = flatCases(lesson).find((x) => x.id === id);
  const img = cleanImage(prediction, lesson);
  if (!c || !img) return null;
  const fields = compareImage(c.expected, img);
  const score = countTrue(fields);
  const allCorrect = score === IMAGE_FIELDS.length;
  return {
    result: { kind, id, match: allCorrect, image: c.expected, fields, anomaly: c.anomaly, explanation: c.anomaly ? c.anomalyExplanation : '' },
    stored: { ...img },
    score,
  };
}

/* ---------------------------------------------------------------- explanations */

/** Surfaces, laws and rays must always be explained; an image only when the first prediction missed. */
export const needsExplanation = (t: OpticsTrial) => t.kind !== 'case' || !t.match;

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
export function numberWords(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '');
}

const normalise = (s: string) => s.toLowerCase().replace(/[-–]/g, ' ').replace(/\s+/g, ' ');

/** Does the text draw on this session's own numbers or words? Digits and spelled-out numbers both count. */
export function meetsAnchors(text: string, groups: string[][] | undefined): boolean {
  if (!groups?.length) return true;
  const t = normalise(text);
  return groups.every((group) =>
    group.some((tok) => {
      const raw = normalise(tok);
      if (/^\d+$/.test(raw)) return new RegExp(`(^|[^\\d])${raw}([^\\d]|$)`).test(t) || t.includes(numberWords(Number(raw)));
      return t.includes(raw);
    }),
  );
}

const wc = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
export { wc as wordCount };

export interface ExplainInput {
  text: unknown;
  inputMode: unknown;
  speakMs: unknown;
  thinkMs: unknown;
  pasted: unknown;
  blurs: unknown;
}

const anchorsOf = (lesson: OpticsLessonContract, kind: OpticsTrialKind, id: string): string[][] | undefined =>
  kind === 'plane' ? lesson.planeMirror.scenarios.find((s) => s.id === id)?.anchors : kind === 'law' ? lesson.lawsOfReflection.laws.find((l) => l.id === id)?.anchors : kind === 'rule' ? lesson.rayRules.rules.find((r) => r.id === id)?.anchors : undefined;

/** Accept or refuse an explanation. The refusal never says what the answer was, only what is missing. */
export function checkExplanation(lesson: OpticsLessonContract, a: OpticsAssignment, kind: OpticsTrialKind, id: string, input: ExplainInput, now: number): { error: string } | { explanation: Explanation } {
  const t = a.trials[trialKey(kind, id)];
  if (!t) return { error: 'Run the experiment first, then explain what you saw.' };
  if (t.explanation) return { explanation: t.explanation };
  const text = String(input.text ?? '').trim().split(/\s+/).slice(0, lesson.config.maxExplanationWords ?? 80).join(' ');
  const words = wc(text);
  const min = lesson.config.minExplanationWords ?? 8;
  if (words < min) return { error: `Explain it in at least ${min} words.` };
  const inputMode = input.inputMode === 'voice' ? 'voice' : 'typed';
  const speakMs = Math.max(0, Math.min(600_000, Number(input.speakMs) || 0));
  if (lesson.config.requireAudioExplanation && inputMode === 'voice' && speakMs < 3000) return { error: 'Say a little more: the recording is too short.' };
  const dwellMs = Math.max(0, now - t.resultAt);
  if (dwellMs < (lesson.config.minExplainDwellMs ?? 8000)) return { error: 'Take a moment with the diagram first, then explain what you saw.' };
  if (!meetsAnchors(text, anchorsOf(lesson, kind, id))) return { error: 'Include the number or side from the setup shown above the box (the angle, distance or side you were given), and say what you saw.' };
  return {
    explanation: { text, inputMode, speakMs, thinkMs: Math.max(0, Math.min(3_600_000, Number(input.thinkMs) || 0)), dwellMs, pasted: Math.max(0, Math.min(100_000, Number(input.pasted) || 0)), blurs: Math.max(0, Math.min(1000, Number(input.blurs) || 0)), words, at: now },
  };
}

/** The first run that still owes an explanation, if any. */
export const owesExplanation = (a: OpticsAssignment): OpticsTrial | null => Object.values(a.trials).find((t) => needsExplanation(t) && !t.explanation) ?? null;

/* ---------------------------------------------------------------- order of the lab */

/** Whether a trial may be run yet: plane first, then the laws, then the rules, then concave, then convex. */
export function stageBlocker(lesson: OpticsLessonContract, a: OpticsAssignment, kind: OpticsTrialKind, id: string): string | null {
  if (owesExplanation(a)) return 'Explain your last run first';
  const done = (k: OpticsTrialKind, list: string[]) => list.every((i) => a.trials[trialKey(k, i)]);
  const planeIds = lesson.planeMirror.scenarios.map((s) => s.id);
  const lawIds = lesson.lawsOfReflection.laws.map((l) => l.id);
  if (kind === 'law' && !done('plane', planeIds)) return 'Fire the laser at both surfaces first';
  if (kind === 'rule' && !done('plane', planeIds)) return 'Fire the laser at both surfaces first';
  if (kind === 'rule' && !done('law', lawIds)) return 'Test the three laws of reflection first';
  if (kind === 'case') {
    if (!done('law', lawIds) || !done('plane', planeIds)) return 'Test the laws of reflection first';
    if (!done('rule', lesson.rayRules.rules.map((r) => r.id))) return 'Learn the four ray rules first';
    const c = flatCases(lesson).find((x) => x.id === id);
    if (c?.mirror === 'convex' && !done('case', flatCases(lesson).filter((x) => x.mirror === 'concave').map((x) => x.id))) return 'Finish the concave mirror first';
  }
  return null;
}

export const allTrialsDone = (lesson: OpticsLessonContract, a: OpticsAssignment) =>
  lesson.planeMirror.scenarios.every((s) => a.trials[trialKey('plane', s.id)]) &&
  lesson.lawsOfReflection.laws.every((l) => a.trials[trialKey('law', l.id)]) &&
  lesson.rayRules.rules.every((r) => a.trials[trialKey('rule', r.id)]) &&
  flatCases(lesson).every((c) => a.trials[trialKey('case', c.id)]) &&
  owesExplanation(a) === null;

/** The student's own table, kept only for cases and only when well formed; falls back to their first prediction. */
export function cleanTable(raw: unknown, lesson: OpticsLessonContract, a: OpticsAssignment): Record<string, OpticsImage> {
  const out: Record<string, OpticsImage> = {};
  for (const c of flatCases(lesson)) {
    const img = cleanImage((raw as Record<string, unknown> | null)?.[c.id], lesson);
    out[c.id] = img ?? (cleanImage(a.trials[trialKey('case', c.id)]?.prediction, lesson) as OpticsImage);
  }
  return out;
}

/** Everything disclosed at lock-in. Pure: works from the lesson and the stored assignment. */
export function buildReveal(lesson: OpticsLessonContract, a: OpticsAssignment): OpticsReveal {
  const sub = a.submission;
  const cases: OpticsRevealCase[] = flatCases(lesson).map((c) => {
    const yours = sub?.table[c.id] ?? null;
    return { id: c.id, mirror: c.mirror, objectPosition: c.objectPosition, expected: c.expected, yours, fields: compareImage(c.expected, yours), anomaly: c.anomaly, explanation: c.anomalyExplanation };
  });
  const planes = lesson.planeMirror.scenarios.filter((s) => a.trials[trialKey('plane', s.id)]?.match).length;
  const rules = lesson.rayRules.rules.filter((r) => a.trials[trialKey('rule', r.id)]?.match).length;
  const laws = lesson.lawsOfReflection.laws.filter((l) => a.trials[trialKey('law', l.id)]?.match).length;
  return {
    lawsCorrect: laws,
    lawsTotal: lesson.lawsOfReflection.laws.length,
    laws: lesson.lawsOfReflection.laws.map((l) => ({ id: l.id, statement: l.statement ?? '' })),
    planeCorrect: planes,
    planeTotal: lesson.planeMirror.scenarios.length,
    rulesCorrect: rules,
    rulesTotal: lesson.rayRules.rules.length,
    tableCorrect: cases.filter((c) => IMAGE_FIELDS.every((f) => c.fields[f])).length,
    tableTotal: cases.length,
    cases,
    uses: lesson.uses ?? [],
  };
}

/** Truth for the rubric engine: per case, how right the first prediction and the final table were, plus how each run was explained. */
export function truthFor(lesson: OpticsLessonContract, a: OpticsAssignment) {
  const of = (kind: OpticsTrialKind, list: string[]) => list.map((i) => a.trials[trialKey(kind, i)]).filter(Boolean);
  const planeTrials = of('plane', lesson.planeMirror.scenarios.map((s) => s.id));
  const lawTrials = of('law', lesson.lawsOfReflection.laws.map((l) => l.id));
  const ruleTrials = of('rule', lesson.rayRules.rules.map((r) => r.id));
  const trials = Object.values(a.trials);
  return {
    plane: { correct: planeTrials.filter((t) => t.match).length, total: lesson.planeMirror.scenarios.length },
    laws: { correct: lawTrials.filter((t) => t.match).length, total: lesson.lawsOfReflection.laws.length },
    rules: { correct: ruleTrials.filter((t) => t.match).length, total: lesson.rayRules.rules.length },
    cases: flatCases(lesson)
      .map((c) => {
        const t = a.trials[trialKey('case', c.id)];
        if (!t) return null;
        const final = a.submission?.table[c.id];
        const finalScore = final ? countTrue(compareImage(c.expected, final)) : null;
        return { id: c.id, mirror: c.mirror, anomaly: c.anomaly, firstScore: t.score, finalScore, revised: final ? IMAGE_FIELDS.some((f) => final[f] !== t.prediction[f]) : false };
      })
      .filter(Boolean),
    explanations: {
      required: trials.filter(needsExplanation).length,
      given: trials.filter((t) => t.explanation).map((t) => ({ kind: t.kind, id: t.id, inputMode: t.explanation!.inputMode, speakMs: t.explanation!.speakMs, dwellMs: t.explanation!.dwellMs, thinkMs: t.thinkMs, words: t.explanation!.words, pasted: t.explanation!.pasted, blurs: t.explanation!.blurs })),
    },
    submitted: a.submission !== null,
  };
}
