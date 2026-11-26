/*
 * Server-side rules for the mission labs ported from MMAXR: Atom Builder, Ionic Bonding and Plant vs Animal Cell.
 *
 * A lab is a run of missions in a fixed order. The student builds something and presses Check; the server works
 * out what the build is (element, charge, shells, ions...) from the raw particles and compares that with the
 * mission's goal, which never leaves the server. Meeting a mission unlocks its checkpoint questions, dealt in a
 * per-session option order under opaque ids; the right answer is disclosed only once a question is answered.
 * Hints are handed out one at a time and counted, as in MMAXR (nudge, clue, explanation).
 */
import { dealOptions, type Rand } from './questionEngine';

export type MissionsLabType = 'chemistry_atom_builder' | 'chemistry_ionic_bonding' | 'biology_cell_explorer';
export const MISSION_LAB_TYPES: readonly string[] = ['chemistry_atom_builder', 'chemistry_ionic_bonding', 'biology_cell_explorer'];
export const isMissionsLesson = (l: { type?: string } | null | undefined): boolean => !!l && MISSION_LAB_TYPES.includes(l.type ?? '');

export interface MissionOption {
  id: string;
  label: string;
}
export interface MissionQuestion {
  id: string;
  prompt: string;
  options: MissionOption[];
  answer: string;
  explanation: string;
}
export interface Narration {
  text: string;
  audioUrl: string | null;
}
export interface Mission {
  id: string;
  title: string;
  goalText: string;
  goal: Record<string, unknown>;
  hints: string[];
  start: Narration | null;
  complete: Narration | null;
  questions: MissionQuestion[];
}
export interface MissionsLesson {
  lessonId: string;
  type: MissionsLabType;
  title: string;
  intro: Narration | null;
  invalid: Narration | null;
  missions: Mission[];
  bundleUrl?: string;
  [k: string]: unknown;
}

export interface MissionsAssignment {
  kind: 'missions';
  lessonId: string;
  studentId: string;
  /** Option order per question id, as dealt to this session. */
  order: Record<string, string[]>;
  progress: Record<string, { attempts: number; hintsUsed: number; metAt: number | null }>;
  answers: Record<string, { choice: string; correct: boolean; thinkMs: number; at: number }>;
  finishedAt: number | null;
  createdAt: number;
}

export const NOT_YET = 'Not yet. The model does not match every part of the goal. Read the goal again and check once more.';
const HINT_LEVELS = ['nudge', 'clue', 'explanation'] as const;

/* ---------------- chemistry: what a build is ---------------- */

const SYMBOLS = ['H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca'];
const MAX_ELECTRONS = 20;

/** Electrons a shell (1-based) may hold at this level: 2, then 8, 8, 2 (Bohr-Bury for elements 1-20). */
export const shellLimit = (shell: number) => Math.min(2 * shell * shell, 8);

const isCount = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= max;

/** Shells with trailing empty shells removed, or null when they break the filling rules. */
export function cleanShells(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length > 4 || !raw.every((n) => isCount(n, 8))) return null;
  const shells = [...(raw as number[])];
  while (shells.length && shells[shells.length - 1] === 0) shells.pop();
  for (let i = 0; i < shells.length; i++) {
    if (shells[i] > shellLimit(i + 1)) return null;
    // Inner shells fill first: a shell with electrons outside it must be full.
    if (i < shells.length - 1 && shells[i] < shellLimit(i + 1)) return null;
  }
  if (shells.reduce((a, b) => a + b, 0) > MAX_ELECTRONS) return null;
  return shells;
}

export function hasCompleteOuterShell(shells: readonly number[]): boolean {
  const outer = shells.length - 1;
  return outer >= 0 && shells[outer] === (outer === 0 ? 2 : 8);
}

export const formatIon = (symbol: string, charge: number) => (charge === 0 ? symbol : `${symbol}${Math.abs(charge) === 1 ? '' : Math.abs(charge)}${charge > 0 ? '+' : '-'}`);

/** The facts an Atom Builder goal is written in, from the raw particles. Null for an impossible build. */
export function atomFacts(state: unknown): Record<string, unknown> | null {
  const s = state as { protons?: unknown; neutrons?: unknown; shells?: unknown } | null;
  if (!s || !isCount(s.protons, 20) || s.protons < 1 || !isCount(s.neutrons, 40)) return null;
  const shells = cleanShells(s.shells);
  if (!shells) return null;
  const electrons = shells.reduce((a, b) => a + b, 0);
  return {
    symbol: SYMBOLS[s.protons - 1],
    protons: s.protons,
    neutrons: s.neutrons,
    electrons,
    massNumber: s.protons + s.neutrons,
    charge: s.protons - electrons,
    electronConfiguration: shells,
    outerShellComplete: hasCompleteOuterShell(shells),
  };
}

/** Sodium (11) and chlorine (17): the only pair this lab bonds. */
const IONIC_PAIR = [
  { key: 'sodium', symbol: 'Na', protons: 11 },
  { key: 'chlorine', symbol: 'Cl', protons: 17 },
] as const;

/**
 * The facts an Ionic Bonding goal is written in. Electrons only move between the two atoms, so the total stays 28;
 * a join is only real when both are ions with complete outer shells and the charges cancel.
 */
export function ionicFacts(state: unknown): Record<string, unknown> | null {
  const s = state as { sodium?: unknown; chlorine?: unknown; bonded?: unknown } | null;
  if (!s) return null;
  const shells = IONIC_PAIR.map((p) => cleanShells((s as Record<string, unknown>)[p.key]));
  if (shells.some((x) => !x)) return null;
  const counts = shells.map((x) => x!.reduce((a, b) => a + b, 0));
  if (counts[0] + counts[1] !== IONIC_PAIR[0].protons + IONIC_PAIR[1].protons) return null;
  const charges = IONIC_PAIR.map((p, i) => p.protons - counts[i]);
  const complete = shells.every((x) => hasCompleteOuterShell(x!));
  const net = charges[0] + charges[1];
  const bonded = s.bonded === true && complete && net === 0;
  if (s.bonded === true && !bonded) return null;
  return {
    compound: 'nacl',
    formula: 'NaCl',
    ions: IONIC_PAIR.map((p, i) => formatIon(p.symbol, charges[i])),
    electronsTransferred: Math.max(0, charges[0]),
    allOuterShellsComplete: complete,
    netCharge: net,
    bonded,
  };
}

/** The cell explorer reports the chapter it finished; its own journey decides when that is. */
export function cellFacts(state: unknown): Record<string, unknown> | null {
  const chapter = (state as { chapter?: unknown } | null)?.chapter;
  return typeof chapter === 'string' && /^[a-z-]{1,40}$/.test(chapter) ? { chapter } : null;
}

export function factsFor(type: MissionsLabType, state: unknown): Record<string, unknown> | null {
  if (type === 'chemistry_atom_builder') return atomFacts(state);
  if (type === 'chemistry_ionic_bonding') return ionicFacts(state);
  return cellFacts(state);
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A goal is met when every field it names matches the build (MMAXR's rule). */
export const meetsGoal = (goal: Record<string, unknown>, facts: Record<string, unknown>) => Object.entries(goal).every(([k, v]) => same(facts[k], v));

/* ---------------- the run ---------------- */

/** Options are dealt in a fresh order for the chemistry labs; the cell explorer shows its own fixed order. */
export function newAssignment(lesson: MissionsLesson, studentId: string, rand: Rand): MissionsAssignment {
  const order: Record<string, string[]> = {};
  let lastSlot: number | undefined;
  for (const m of lesson.missions) {
    for (const q of m.questions) {
      const ids = q.options.map((o) => o.id);
      order[q.id] = lesson.type === 'biology_cell_explorer' ? ids : dealOptions(ids, rand, q.answer, lastSlot);
      lastSlot = order[q.id].indexOf(q.answer);
    }
  }
  return {
    kind: 'missions',
    lessonId: lesson.lessonId,
    studentId,
    order,
    progress: Object.fromEntries(lesson.missions.map((m) => [m.id, { attempts: 0, hintsUsed: 0, metAt: null }])),
    answers: {},
    finishedAt: null,
    createdAt: Date.now(),
  };
}

/** Opaque option id the browser uses: its position in the dealt order. */
export const posId = (i: number) => `p${i}`;

const questionsOf = (m: Mission, a: MissionsAssignment) =>
  m.questions.map((q) => ({ id: q.id, prompt: q.prompt, options: (a.order[q.id] ?? q.options.map((o) => o.id)).map((id, i) => ({ id: posId(i), label: q.options.find((o) => o.id === id)?.label ?? '' })) }));

/** The mission to work on: the first one not met, or the first met one whose questions are not all answered. */
export function currentMission(lesson: MissionsLesson, a: MissionsAssignment): Mission | null {
  for (const m of lesson.missions) {
    if (a.progress[m.id]?.metAt == null) return m;
    if (m.questions.some((q) => !a.answers[q.id])) return m;
  }
  return null;
}

export function progressOf(lesson: MissionsLesson, a: MissionsAssignment) {
  const current = currentMission(lesson, a);
  return {
    current: current?.id ?? null,
    missions: Object.fromEntries(lesson.missions.map((m) => [m.id, { attempts: a.progress[m.id]?.attempts ?? 0, hintsUsed: a.progress[m.id]?.hintsUsed ?? 0, met: a.progress[m.id]?.metAt != null }])),
    answered: Object.keys(a.answers),
    finished: a.finishedAt !== null,
  };
}

type Fail = { error: string; status: number };

/** Check the build against the current mission. Mutates the assignment (attempts, met). */
export function checkMission(lesson: MissionsLesson, a: MissionsAssignment, missionId: string, state: unknown, now: number): Fail | { met: boolean; attempts: number; feedback: string | null; questions: ReturnType<typeof questionsOf> } {
  const m = lesson.missions.find((x) => x.id === missionId);
  if (!m) return { error: 'Unknown mission', status: 400 };
  const p = a.progress[m.id];
  if (p.metAt != null) return { met: true, attempts: p.attempts, feedback: null, questions: questionsOf(m, a).filter((q) => !a.answers[q.id]) };
  if (currentMission(lesson, a)?.id !== m.id) return { error: 'Finish the mission before this one first', status: 409 };
  const facts = factsFor(lesson.type, state);
  if (!facts) return { error: 'That build is not possible', status: 400 };
  p.attempts += 1;
  if (!meetsGoal(m.goal, facts)) return { met: false, attempts: p.attempts, feedback: NOT_YET, questions: [] };
  p.metAt = now;
  return { met: true, attempts: p.attempts, feedback: null, questions: questionsOf(m, a) };
}

/** The next hint of the current mission. Mutates the assignment (hints used). */
export function nextHint(lesson: MissionsLesson, a: MissionsAssignment, missionId: string): Fail | { hint: string; level: (typeof HINT_LEVELS)[number]; used: number; total: number } {
  const m = lesson.missions.find((x) => x.id === missionId);
  if (!m) return { error: 'Unknown mission', status: 400 };
  const p = a.progress[m.id];
  if (p.metAt != null) return { error: 'This mission is already done', status: 409 };
  if (p.hintsUsed >= m.hints.length) return { error: 'No more hints for this mission', status: 409 };
  const index = p.hintsUsed;
  p.hintsUsed += 1;
  return { hint: m.hints[index], level: HINT_LEVELS[Math.min(index, HINT_LEVELS.length - 1)], used: p.hintsUsed, total: m.hints.length };
}

/** Mark one answer. `pick` is the opaque position id the browser sent. Mutates the assignment. */
export function answerQuestion(lesson: MissionsLesson, a: MissionsAssignment, qid: string, pick: string, thinkMs: number, now: number): Fail | { correct: boolean; answer: string; explanation: string } {
  const m = lesson.missions.find((x) => x.questions.some((q) => q.id === qid));
  const q = m?.questions.find((x) => x.id === qid);
  if (!m || !q) return { error: 'Unknown question', status: 400 };
  if (a.progress[m.id]?.metAt == null) return { error: 'Meet the mission goal before its questions', status: 409 };
  const order = a.order[q.id] ?? q.options.map((o) => o.id);
  const answerPos = posId(order.indexOf(q.answer));
  const stored = a.answers[q.id];
  if (stored) return { correct: stored.correct, answer: answerPos, explanation: q.explanation };
  const at = /^p([0-3])$/.exec(pick);
  const choice = at ? order[Number(at[1])] : undefined;
  if (choice === undefined) return { error: 'Pick one of the options', status: 400 };
  const correct = choice === q.answer;
  a.answers[q.id] = { choice, correct, thinkMs: Math.max(0, Math.min(3_600_000, Math.round(thinkMs) || 0)), at: now };
  return { correct, answer: answerPos, explanation: q.explanation };
}

export function summaryOf(lesson: MissionsLesson, a: MissionsAssignment) {
  const all = lesson.missions.flatMap((m) => m.questions);
  return {
    missions: lesson.missions.length,
    hintsUsed: Object.values(a.progress).reduce((s, p) => s + p.hintsUsed, 0),
    attempts: Object.values(a.progress).reduce((s, p) => s + p.attempts, 0),
    correct: all.filter((q) => a.answers[q.id]?.correct).length,
    total: all.length,
  };
}

/** Finish the run once every mission is met and every question answered. Mutates the assignment. */
export function finish(lesson: MissionsLesson, a: MissionsAssignment, now: number): Fail | ReturnType<typeof summaryOf> {
  if (currentMission(lesson, a)) return { error: 'Finish every mission and its questions first', status: 409 };
  a.finishedAt ??= now;
  return summaryOf(lesson, a);
}

/* ---------------- what the browser may see ---------------- */

export function redactMissions(lesson: MissionsLesson) {
  const { missions, ...rest } = lesson;
  return {
    ...rest,
    missions: missions.map((m) => ({ id: m.id, title: m.title, goalText: m.goalText, hintCount: m.hints.length, start: m.start, complete: m.complete })),
  };
}

/** What the coach and rubric engine read. Never exposed to browsers. */
export function missionsInternal(lesson: MissionsLesson, a: MissionsAssignment) {
  const questions = lesson.missions.flatMap((m) => m.questions.map((q) => ({ m, q })));
  return {
    kind: 'missions',
    labType: lesson.type,
    lessonId: a.lessonId,
    studentId: a.studentId,
    submitted: a.finishedAt !== null,
    submission: null,
    // For the coach's guard: each question, with whether it is still open.
    tubes: questions.map(({ m, q }, i) => ({ tube: i + 1, id: q.id, name: m.title, formula: '', type: '', ph: 0, facts: q.explanation, terms: [q.options.find((o) => o.id === q.answer)?.label ?? ''].filter((t) => t.length >= 3), open: !a.answers[q.id] })),
    missions: { ...summaryOf(lesson, a), progress: progressOf(lesson, a) },
    // For the rubric engine: per mission, how it was reached and how its questions went. Never sent to browsers.
    missionDetail: lesson.missions.map((m) => ({
      id: m.id,
      attempts: a.progress[m.id]?.attempts ?? 0,
      hintsUsed: a.progress[m.id]?.hintsUsed ?? 0,
      hintsAvailable: m.hints.length,
      met: a.progress[m.id]?.metAt != null,
      questions: m.questions.map((q) => ({ id: q.id, answered: !!a.answers[q.id], correct: a.answers[q.id]?.correct ?? false, thinkMs: a.answers[q.id]?.thinkMs ?? 0 })),
    })),
  };
}
