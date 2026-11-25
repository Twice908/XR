/*
 * Server-side rules for the Sound & Waves sandbox (ripple tank + oscilloscope, echoes and reverberation, sonar and
 * ultrasound). Like the optics lab it is built around the process of finding things out:
 *  - every session gets its own run: the frequencies, distances and echo times are drawn from pools, the tasks in a
 *    tab and the answer options of every question come in a different order;
 *  - nothing is disclosed until the student has committed a prediction AND actually run the experiment (set the
 *    generator, clapped in both places, timed the echo, sent the pulse), which the service checks;
 *  - the calculation of a distance is checked against the student's own reading, and the explanation of what
 *    happened is held back until the student has explained it themselves, in their own words and with their own numbers.
 */
import type { SoundAct, SoundCalcResult, SoundLessonContract, SoundReveal, SoundTask, SoundTrialResult } from '@mmaxr/schema';
import { meetsAnchors, wordCount } from './optics';
import { pickIndex, shuffle, type Rand } from './questionEngine';

export interface SoundExplanation {
  text: string;
  inputMode: 'voice' | 'typed';
  speakMs: number;
  thinkMs: number;
  dwellMs: number;
  pasted: number;
  blurs: number;
  words: number;
  at: number;
  audioUrl?: string;
}

export interface SoundTrial {
  id: string;
  prediction: string;
  confidence: 1 | 2 | 3;
  thinkMs: number;
  at: number;
  resultAt: number;
  match: boolean;
  act: SoundAct;
  /** Tasks that end in a calculation: how many tries it took, and whether it was accepted. */
  calcAttempts: number;
  calcValue: number | null;
  calcOk: boolean;
  explanation?: SoundExplanation;
}

export interface SoundPlan {
  taskOrder: Record<string, string[]>;
  tasks: Record<string, { variant: number; optionOrder: string[] }>;
}

export interface SoundAssignment {
  kind: 'sound';
  lessonId: string;
  studentId: string;
  plan: SoundPlan;
  trials: Record<string, SoundTrial>;
  submission: { at: number } | null;
  createdAt: number;
}


export function makePlan(lesson: SoundLessonContract, rand: Rand = Math.random): SoundPlan {
  const plan: SoundPlan = { taskOrder: {}, tasks: {} };
  for (const sc of lesson.scenarios) {
    plan.taskOrder[sc.id] = shuffle(sc.tasks.map((t) => t.id), rand);
    for (const t of sc.tasks) plan.tasks[t.id] = { variant: pickIndex(t.variants?.length ?? 1, rand), optionOrder: shuffle(t.predictionOptions.map((o) => o.id), rand) };
  }
  return plan;
}

/* ---------------------------------------------------------------- physics of each task */

type Vars = Record<string, number | string>;
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Derived {
  /** Filled into the prompt, options, explanation and anchors. */
  vars: Vars;
  /** The only values the browser is given to set the experiment up. */
  params: Record<string, number | string>;
  /** Why the act is not good enough yet, if it is not. Never reveals a result. */
  actError(act: SoundAct): string | null;
  /** Readings the instruments show once the experiment has run. */
  data(act: SoundAct): Record<string, number | string>;
  /** Facts disclosed only after the student has explained the run. */
  facts: Record<string, number | string>;
  calc?: { truth: number; tol: number; unit: string };
}

export function derive(taskId: string, v: Record<string, number | string>): Derived {
  const n = (k: string) => Number(v[k]);
  switch (taskId) {
    case 'wave_1': {
      const f1 = n('f1');
      const f2 = n('f2');
      const speed = n('v');
      const l1 = (speed / f1) * 100;
      const l2 = (speed / f2) * 100;
      return {
        vars: { f1, f2 },
        params: { f1, f2, speed },
        actError: (a) => (Math.abs((a.freq ?? 0) - f2) > 0.6 ? `Set the generator to ${f2} Hz first, then observe.` : null),
        data: () => ({ f1, f2, speed, lambda1Cm: r1(l1), lambda2Cm: r1(l2), period2Ms: Math.round(1000 / f2) }),
        facts: { speed, product1: r2(f1 * (l1 / 100)), product2: r2(f2 * (l2 / 100)), lambda1Cm: r1(l1), lambda2Cm: r1(l2) },
      };
    }
    case 'wave_2': {
      const a1 = n('a1');
      const a2 = n('a2');
      const gain = r1(20 * Math.log10(a2 / a1));
      return {
        vars: { a1, a2 },
        params: { a1, a2 },
        actError: (a) => (Math.abs((a.amp ?? 0) - a2) > 0.35 ? `Set the amplitude to ${a2} mm first, then observe.` : null),
        data: () => ({ a1, a2, gainDb: gain }),
        facts: { gainDb: gain },
      };
    }
    case 'echo_1': {
      const rt = n('rt');
      return {
        vars: { rt },
        params: { rt },
        actError: (a) => (a.clappedField && a.clappedRoom ? null : 'Clap in both the open field and the small room first.'),
        data: () => ({ rt }),
        facts: { rt },
      };
    }
    case 'echo_2': {
      const t = n('t');
      const speed = n('v');
      const d = r1((speed * t) / 2);
      return {
        vars: { t: t.toFixed(1), v: speed, d, d2: r1(d * 2), dh: r1(d / 2), tot: r1(d * 2) },
        params: { t, speed },
        actError: (a) => (typeof a.measuredT !== 'number' || Math.abs(a.measuredT - t) > 0.6 ? 'Your stopwatch reading is not close to the echo delay. Start it at your shout and stop it when you hear the echo.' : null),
        data: (a) => ({ t, measuredT: r2(a.measuredT ?? 0), speed }),
        facts: { distanceM: d, totalPathM: r1(d * 2), speed, t },
      };
    }
    case 'sonar_1': {
      const t = n('t');
      const speed = n('v');
      const h = r1((speed * t) / 2);
      return {
        vars: { t: t.toFixed(1), v: speed, target: String(v.target), h, h2: r1(h * 2), hh: r1(h / 2) },
        params: { speed, target: String(v.target), t },
        actError: (a) => (a.pulse ? null : 'Send a sonar pulse first.'),
        data: () => ({ t, speed }),
        facts: { depthM: h, totalPathM: r1(h * 2), speed, t },
        calc: { truth: h, tol: 0.04, unit: 'm' },
      };
    }
    case 'ultrasound_1': {
      const s = n('s');
      const fa = n('fa');
      return {
        vars: { s, fa },
        params: { s, fa },
        actError: (a) => (a.scannedAudible && a.scannedUltra ? null : 'Run the scan with audible sound and with ultrasound first.'),
        data: () => ({ s, lambdaAudibleCm: Math.round((343 / (fa * 1000)) * 100), lambdaUltraMm: r2((1540 / 5_000_000) * 1000) }),
        facts: { lambdaAudibleCm: Math.round((343 / (fa * 1000)) * 100), lambdaUltraMm: r2((1540 / 5_000_000) * 1000), cystMm: s },
      };
    }
  }
  throw new Error(`Unknown task ${taskId}`);
}

const fill = (tpl: string, vars: Vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));

/** The lesson as this session runs it, still holding the answers. */
export function personalize(lesson: SoundLessonContract, plan: SoundPlan): SoundLessonContract {
  const out: SoundLessonContract = JSON.parse(JSON.stringify(lesson));
  for (const sc of out.scenarios) {
    const byId = new Map(sc.tasks.map((t) => [t.id, t]));
    sc.tasks = plan.taskOrder[sc.id].map((id) => {
      const t = byId.get(id)!;
      const p = plan.tasks[id];
      const v = t.variants?.[p.variant] ?? {};
      const d = derive(id, v);
      const { variants: _v, ...rest } = t;
      return {
        ...rest,
        prompt: fill(t.prompt, d.vars),
        predictionOptions: p.optionOrder.map((oid) => t.predictionOptions.find((o) => o.id === oid)!).map((o) => ({ ...o, label: fill(o.label, d.vars) })),
        params: d.params,
        explanation: t.explanation && fill(t.explanation, d.vars),
        anchors: t.anchors?.map((g) => g.map((x) => fill(x, d.vars))),
      } as SoundTask;
    });
  }
  return out;
}

/** The task as it was drawn for this session, with its derived physics. */
export function drawn(lesson: SoundLessonContract, plan: SoundPlan, taskId: string) {
  const raw = lesson.scenarios.flatMap((s) => s.tasks).find((t) => t.id === taskId);
  if (!raw) return null;
  const variant = raw.variants?.[plan.tasks[taskId]?.variant ?? 0] ?? {};
  return { raw, d: derive(taskId, variant) };
}

export function redactSound(lesson: any): any {
  const { uses: _u, ...rest } = lesson;
  return {
    ...rest,
    scenarios: lesson.scenarios.map((s: any) => ({
      ...s,
      tasks: s.tasks.map(({ answer: _a, expectedOutcome: _e, explanation: _x, isAnomaly: _i, anomalyExplanation: _ae, anchors: _an, variants: _v, ...t }: any) => t),
    })),
  };
}

/* ---------------------------------------------------------------- trials */

export const flatTasks = (lesson: SoundLessonContract) => lesson.scenarios.flatMap((s) => s.tasks);

/** Judge a prediction and the act that goes with it. Returns an error string for a bad act, null for a bad request. */
export function judgeTrial(lesson: SoundLessonContract, plan: SoundPlan, id: string, prediction: unknown, act: SoundAct): { error: string } | { result: SoundTrialResult; match: boolean; stored: string; act: SoundAct } | null {
  const task = flatTasks(lesson).find((t) => t.id === id);
  const dr = drawn(lesson, plan, id);
  if (!task || !dr || typeof prediction !== 'string' || !task.predictionOptions.some((o) => o.id === prediction)) return null;
  const clean: SoundAct = {
    freq: Number.isFinite(Number(act?.freq)) ? Number(act.freq) : undefined,
    amp: Number.isFinite(Number(act?.amp)) ? Number(act.amp) : undefined,
    clappedField: act?.clappedField === true,
    clappedRoom: act?.clappedRoom === true,
    measuredT: Number.isFinite(Number(act?.measuredT)) ? Number(act.measuredT) : undefined,
    pulse: act?.pulse === true,
    scannedAudible: act?.scannedAudible === true,
    scannedUltra: act?.scannedUltra === true,
  };
  const err = dr.d.actError(clean);
  if (err) return { error: err };
  const match = prediction === task.answer;
  return { result: { id, match, anomaly: match ? undefined : dr.raw.isAnomaly === true ? true : undefined, data: dr.d.data(clean) }, match, stored: prediction, act: clean };
}

/** Is the calculation close enough to this session's own numbers? */
export function checkCalc(lesson: SoundLessonContract, plan: SoundPlan, t: SoundTrial, value: unknown): SoundCalcResult | { error: string } {
  const dr = drawn(lesson, plan, t.id);
  if (!dr?.d.calc) return { error: 'This task has no calculation.' };
  if (t.calcOk) return { ok: true, attempts: t.calcAttempts, value: t.calcValue ?? undefined };
  const x = Number(value);
  if (!Number.isFinite(x) || x <= 0 || x > 1e7) return { error: 'Enter a number.' };
  t.calcAttempts += 1;
  const ok = Math.abs(x - dr.d.calc.truth) / dr.d.calc.truth <= dr.d.calc.tol;
  if (ok) {
    t.calcOk = true;
    t.calcValue = x;
  }
  return { ok, attempts: t.calcAttempts, value: ok ? x : undefined };
}

export const hasCalc = (lesson: SoundLessonContract, plan: SoundPlan, id: string) => !!drawn(lesson, plan, id)?.d.calc;

/* ---------------------------------------------------------------- explanations */

export interface SoundExplainInput {
  text: unknown;
  inputMode: unknown;
  speakMs: unknown;
  thinkMs: unknown;
  pasted: unknown;
  blurs: unknown;
}

export function checkExplanation(lesson: SoundLessonContract, a: SoundAssignment, id: string, input: SoundExplainInput, now: number): { error: string } | { explanation: SoundExplanation } {
  const t = a.trials[id];
  if (!t) return { error: 'Run the experiment first, then explain what you saw.' };
  if (t.explanation) return { explanation: t.explanation };
  if (hasCalc(lesson, a.plan, id) && !t.calcOk) return { error: 'Finish the calculation first.' };
  const text = String(input.text ?? '').trim().split(/\s+/).slice(0, lesson.config.maxExplanationWords ?? 80).join(' ');
  const words = wordCount(text);
  const min = lesson.config.minExplanationWords ?? 8;
  if (words < min) return { error: `Explain it in at least ${min} words.` };
  const inputMode = input.inputMode === 'voice' ? 'voice' : 'typed';
  const speakMs = Math.max(0, Math.min(600_000, Number(input.speakMs) || 0));
  if (lesson.config.requireAudioExplanation && inputMode === 'voice' && speakMs < 3000) return { error: 'Say a little more: the recording is too short.' };
  const dwellMs = Math.max(0, now - t.resultAt);
  if (dwellMs < (lesson.config.minExplainDwellMs ?? 8000)) return { error: 'Take a moment with the instruments first, then explain what you saw.' };
  const anchors = drawn(lesson, a.plan, id) && personalize(lesson, a.plan).scenarios.flatMap((s) => s.tasks).find((x) => x.id === id)?.anchors;
  if (!meetsAnchors(text, anchors)) return { error: 'Include a number from your own run (one shown in the task or read from an instrument) and say what you saw.' };
  return { explanation: { text, inputMode, speakMs, thinkMs: Math.max(0, Math.min(3_600_000, Number(input.thinkMs) || 0)), dwellMs, pasted: Math.max(0, Math.min(100_000, Number(input.pasted) || 0)), blurs: Math.max(0, Math.min(1000, Number(input.blurs) || 0)), words, at: now } };
}

/** What is disclosed once the student has explained a run. */
export function revealFor(lesson: SoundLessonContract, plan: SoundPlan, id: string) {
  const p = personalize(lesson, plan).scenarios.flatMap((s) => s.tasks).find((t) => t.id === id)!;
  const dr = drawn(lesson, plan, id)!;
  return { explanation: p.explanation ?? p.expectedOutcome ?? '', anomalyExplanation: dr.raw.isAnomaly ? dr.raw.anomalyExplanation : undefined, facts: dr.d.facts };
}

export const owesExplanation = (a: SoundAssignment): SoundTrial | null => Object.values(a.trials).find((t) => !t.explanation) ?? null;

export const allDone = (lesson: SoundLessonContract, a: SoundAssignment) => flatTasks(lesson).every((t) => a.trials[t.id]?.explanation && (!hasCalc(lesson, a.plan, t.id) || a.trials[t.id].calcOk));

export function buildReveal(lesson: SoundLessonContract, a: SoundAssignment): SoundReveal {
  const p = personalize(lesson, a.plan);
  const tasks = flatTasks(p).map((t) => {
    const tr = a.trials[t.id];
    return {
      id: t.id,
      prompt: t.prompt,
      yourPrediction: t.predictionOptions.find((o) => o.id === tr?.prediction)?.label ?? '–',
      right: tr?.match === true,
      answerLabel: t.predictionOptions.find((o) => o.id === t.answer)?.label ?? '',
      explanation: t.explanation ?? t.expectedOutcome ?? '',
      facts: drawn(lesson, a.plan, t.id)!.d.facts,
    };
  });
  return { tasks, correct: tasks.filter((t) => t.right).length, total: tasks.length, calcAttempts: Object.values(a.trials).reduce((s, t) => s + t.calcAttempts, 0), uses: lesson.uses ?? [] };
}

/** Truth for the rubric engine. */
export function truthFor(lesson: SoundLessonContract, a: SoundAssignment) {
  const trials = flatTasks(lesson).map((t) => ({ t, tr: a.trials[t.id], dr: drawn(lesson, a.plan, t.id)! })).filter((x) => x.tr);
  return {
    tasks: trials.map(({ t, tr, dr }) => ({ id: t.id, tool: lesson.scenarios.find((s) => s.tasks.some((x) => x.id === t.id))!.tool, match: tr.match, anomaly: dr.raw.isAnomaly === true, hasCalc: !!dr.d.calc, calcAttempts: tr.calcAttempts, calcOk: tr.calcOk })),
    total: flatTasks(lesson).length,
    explanations: {
      required: trials.length,
      given: trials.filter((x) => x.tr.explanation).map(({ t, tr }) => ({ id: t.id, inputMode: tr.explanation!.inputMode, speakMs: tr.explanation!.speakMs, dwellMs: tr.explanation!.dwellMs, thinkMs: tr.thinkMs, words: tr.explanation!.words, pasted: tr.explanation!.pasted, blurs: tr.explanation!.blurs })),
    },
    submitted: a.submission !== null,
  };
}
