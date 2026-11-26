import { action, cap, d, r1, r2 } from './chemistry';
import { travel } from './sensors';
import { band, overall } from './rules';
import {
  LABELS,
  RUBRIC_VERSION,
  type Device,
  type DimensionKey,
  type DimensionResult,
  type EventRow,
  type MissionsLabType,
  type MissionsTruth,
  type Report,
  type SensorData,
  type StatItem,
  type TruthInfo,
} from './types';

/*
 * Deterministic rubric for the mission labs ported from MMAXR: Atom Builder, Ionic Bonding, Plant vs Animal Cell.
 *
 * A run is a fixed list of missions. In the two chemistry labs the student builds a model and presses Check; the
 * server compares it with a hidden goal. Meeting a mission unlocks two checkpoint questions. Hints come one at a time.
 * In the cell lab each chapter is completed by the journey itself, so there are no checks to judge.
 *
 * How each dimension is read (every ratio goes through the shared bands in rules.ts):
 *  - Prediction discipline (chemistry): a Check is the student committing to "this build meets the goal". Share of
 *    missions met on the first Check.
 *  - Retrieval effort (all): how much was worked out without help. 1 - hints used / hints available, over the
 *    missions reached.
 *  - Revision quality (chemistry): after a Check said "not yet", was the build fixed promptly? Full credit when the
 *    mission was met within two more checks, half when later, none when never met.
 *  - Causal coherence (all): share of checkpoint questions (the "why" behind each build or organelle) answered right.
 *  - Metacognitive calibration (chemistry): knowing when to ask for help. Per mission, from the order of checks and
 *    hints: right first time, or asked for a hint after at most two failed checks, is calibrated; guessing on through
 *    three failed checks is half; four or more is none.
 *  - Transfer: chemistry labs, the later missions that apply the model to a new case (Atom Builder: carbon-14 isotope
 *    and chloride ion; Ionic Bonding: joining the ions), half how independently each was built and half its questions.
 *    Cell lab: the recap questions, which ask about the whole cell.
 *
 * Not assessed, by design: calibration and the two check-based dimensions in the cell lab (no checks or confidence).
 */

interface LabRules {
  label: string;
  /** Missions whose task applies what earlier missions taught to a new case. */
  transferMissions: string[];
  /** Hints a mission offers, used only when the lesson service's record is missing. */
  defaultHints: number;
  builds: boolean;
  assessable: DimensionKey[];
}

const CHEM_DIMS: DimensionKey[] = ['predictionDiscipline', 'retrievalEffort', 'revisionQuality', 'causalCoherence', 'metacognitiveCalibration', 'transfer'];
export const MISSION_LABS: Record<MissionsLabType, LabRules> = {
  chemistry_atom_builder: { label: 'atom-builder', transferMissions: ['build-carbon-14', 'make-cl-minus'], defaultHints: 3, builds: true, assessable: CHEM_DIMS },
  chemistry_ionic_bonding: { label: 'ionic-bonding', transferMissions: ['join-ions'], defaultHints: 3, builds: true, assessable: CHEM_DIMS },
  biology_cell_explorer: { label: 'cell-explorer', transferMissions: ['cx-recap'], defaultHints: 2, builds: false, assessable: ['retrievalEffort', 'causalCoherence', 'transfer'] },
};

/** Lesson ids the client sends in enter_lab, mapped to the lab type. */
export const MISSION_LESSON_IDS: Record<string, MissionsLabType> = {
  'atom-builder': 'chemistry_atom_builder',
  'ionic-bonding': 'chemistry_ionic_bonding',
  'cell-explorer': 'biology_cell_explorer',
};

type Mission = MissionsTruth['missions'][number];

const missionOf = (e: EventRow) => {
  const t = String(e.object_data?.target ?? '');
  return t.startsWith('mission:') ? t.slice(8) : null;
};
const questionOf = (e: EventRow) => {
  const t = String(e.object_data?.target ?? '');
  return t.startsWith('question:') ? t.slice(9) : null;
};

/** When the lesson service no longer holds the run, rebuild what it would have said from the xAPI trace. */
export function missionsFromEvents(events: EventRow[], labType: MissionsLabType): MissionsTruth {
  const rules = MISSION_LABS[labType];
  const byId = new Map<string, Mission>();
  const get = (id: string) => {
    let m = byId.get(id);
    if (!m) byId.set(id, (m = { id, attempts: 0, hintsUsed: 0, hintsAvailable: rules.defaultHints, met: false, questions: [] }));
    return m;
  };
  let last: string | null = null;
  for (const e of events) {
    const mid = missionOf(e);
    const a = action(e);
    if (mid) {
      last = mid;
      const m = get(mid);
      if (a === 'check_mission') m.attempts = Math.max(m.attempts + 1, Number(d(e).attempts) || 0);
      if (a === 'hint') m.hintsUsed += 1;
      if (a === 'mission_complete') {
        m.met = true;
        m.attempts = Math.max(m.attempts, Number(e.object_data?.value) || 0);
      }
    }
    const qid = questionOf(e);
    if (qid && a === 'quiz_answer' && last) {
      const m = get(last);
      if (!m.questions.some((q) => q.id === qid)) m.questions.push({ id: qid, answered: true, correct: e.object_data?.value === 'correct', thinkMs: Number(d(e).decisionMs) || 0 });
    }
  }
  return { labType, missions: [...byId.values()], submitted: events.some((e) => action(e) === 'submit_analysis') };
}

const base = (key: DimensionKey) => ({ key, label: LABELS[key], max: 3 as const });
const notAssessed = (key: DimensionKey, why: string): DimensionResult => ({ ...base(key), score: null, basis: why, evidence: [], measures: {} });
const reached = (m: Mission) => m.met || m.attempts > 0 || m.hintsUsed > 0 || m.questions.some((q) => q.answered);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function evidenceFor(events: EventRow[], missions: string[], actions?: string[]) {
  const ids = new Set(missions);
  return cap(events.filter((e) => ids.has(missionOf(e) ?? '') && (!actions || actions.includes(action(e)))).map((e) => e.id));
}

function predictionDiscipline(t: MissionsTruth, events: EventRow[]): DimensionResult {
  const checked = t.missions.filter((m) => m.met && m.attempts > 0);
  if (!checked.length) return notAssessed('predictionDiscipline', 'No build has been checked and met yet.');
  const first = checked.filter((m) => m.attempts === 1).length;
  const ratio = first / checked.length;
  return {
    ...base('predictionDiscipline'),
    score: band(ratio),
    basis: `${first} of ${plural(checked.length, 'mission')} met on the first Check: the build was finished before it was tested.`,
    evidence: evidenceFor(events, checked.map((m) => m.id), ['check_mission']),
    measures: { missionsChecked: checked.length, rightFirstCheck: first, ratio: r2(ratio) },
  };
}

function retrievalEffort(t: MissionsTruth, events: EventRow[]): DimensionResult {
  const r = t.missions.filter(reached);
  const available = r.reduce((s, m) => s + m.hintsAvailable, 0);
  if (!r.length || !available) return notAssessed('retrievalEffort', 'No mission has been started yet.');
  const used = r.reduce((s, m) => s + Math.min(m.hintsUsed, m.hintsAvailable), 0);
  const ratio = 1 - used / available;
  return {
    ...base('retrievalEffort'),
    score: band(ratio),
    basis: `Used ${used} of ${plural(available, 'hint')} available across ${plural(r.length, 'mission')}; the rest was worked out unaided.`,
    evidence: evidenceFor(events, r.map((m) => m.id), ['hint']),
    measures: { missionsReached: r.length, hintsUsed: used, hintsAvailable: available, independence: r2(ratio) },
  };
}

function revisionQuality(t: MissionsTruth, events: EventRow[]): DimensionResult {
  const failed = t.missions.filter((m) => m.attempts > 1 || (!m.met && m.attempts > 0));
  if (!failed.length) {
    const met = t.missions.filter((m) => m.met && m.attempts > 0).length;
    if (!met) return notAssessed('revisionQuality', 'No build has been checked yet.');
    return { ...base('revisionQuality'), score: 3, basis: `Every checked build (${met}) was right first time, so nothing needed revising.`, evidence: [], measures: { revised: 0, missionsChecked: met } };
  }
  const credit = failed.reduce((s, m) => s + (!m.met ? 0 : m.attempts <= 3 ? 1 : 0.5), 0);
  const ratio = credit / failed.length;
  const fixedFast = failed.filter((m) => m.met && m.attempts <= 3).length;
  const stuck = failed.filter((m) => !m.met).length;
  return {
    ...base('revisionQuality'),
    score: band(ratio),
    basis: `${plural(failed.length, 'build')} came back "not yet": ${fixedFast} fixed within two more checks${stuck ? `, ${stuck} still not met` : ''}.`,
    evidence: evidenceFor(events, failed.map((m) => m.id), ['check_mission', 'mission_complete']),
    measures: { needingRevision: failed.length, fixedWithinTwo: fixedFast, notMet: stuck, ratio: r2(ratio) },
  };
}

function causalCoherence(t: MissionsTruth, events: EventRow[]): DimensionResult {
  const qs = t.missions.flatMap((m) => m.questions).filter((q) => q.answered);
  if (!qs.length) return notAssessed('causalCoherence', 'No checkpoint question has been answered yet.');
  const right = qs.filter((q) => q.correct).length;
  const ratio = right / qs.length;
  const ids = new Set(qs.map((q) => q.id));
  return {
    ...base('causalCoherence'),
    score: band(ratio),
    basis: `${right} of ${plural(qs.length, 'checkpoint question')} on why the model works answered right.`,
    evidence: cap(events.filter((e) => action(e) === 'quiz_answer' && ids.has(questionOf(e) ?? '')).map((e) => e.id)),
    measures: { answered: qs.length, right, accuracy: r2(ratio) },
  };
}

/** Per mission, from the order of checks and hints in the trace. */
function calibration(events: EventRow[]): DimensionResult {
  const per = new Map<string, { fails: number; failsBeforeHelp: number | null; met: boolean }>();
  for (const e of events) {
    const mid = missionOf(e);
    if (!mid) continue;
    const s = per.get(mid) ?? { fails: 0, failsBeforeHelp: null, met: false };
    const a = action(e);
    if (a === 'check_mission' && e.object_data?.value === 'not_yet') s.fails += 1;
    if (a === 'hint' && s.failsBeforeHelp === null) s.failsBeforeHelp = s.fails;
    if (a === 'mission_complete' || (a === 'check_mission' && e.object_data?.value === 'met')) s.met = true;
    per.set(mid, s);
  }
  const judged = [...per.entries()].filter(([, s]) => s.met || s.fails > 0);
  if (!judged.length) return notAssessed('metacognitiveCalibration', 'No checks have been recorded yet.');
  let credit = 0;
  for (const [, s] of judged) {
    const unaided = s.failsBeforeHelp ?? s.fails;
    credit += unaided <= 2 ? 1 : unaided === 3 ? 0.5 : 0;
  }
  const ratio = credit / judged.length;
  const guessing = judged.filter(([, s]) => (s.failsBeforeHelp ?? s.fails) >= 3).length;
  return {
    ...base('metacognitiveCalibration'),
    score: band(ratio),
    basis: guessing
      ? `On ${guessing} of ${plural(judged.length, 'mission')} they kept checking through three or more "not yet" results without asking for a hint.`
      : `On all ${plural(judged.length, 'mission')} they either got it right or asked for help within two failed checks.`,
    evidence: evidenceFor(events, judged.map(([id]) => id), ['check_mission', 'hint']),
    measures: { missionsJudged: judged.length, keptGuessing: guessing, ratio: r2(ratio) },
  };
}

function transfer(t: MissionsTruth, rules: LabRules, events: EventRow[]): DimensionResult {
  const targets = t.missions.filter((m) => rules.transferMissions.includes(m.id) && reached(m));
  if (!targets.length) return notAssessed('transfer', 'The missions that apply the model to a new case have not been reached yet.');
  const accuracy = (m: Mission) => {
    const a = m.questions.filter((q) => q.answered);
    return a.length ? a.filter((q) => q.correct).length / a.length : null;
  };
  let sum = 0;
  const parts: string[] = [];
  for (const m of targets) {
    const acc = accuracy(m);
    if (!rules.builds) {
      sum += acc ?? 0;
      parts.push(`${m.id}: ${acc === null ? 'not answered' : `${Math.round(acc * 100)}% of questions right`}`);
      continue;
    }
    const build = !m.met ? 0 : m.attempts <= 1 && m.hintsUsed === 0 ? 1 : m.attempts <= 2 && m.hintsUsed <= 1 ? 0.75 : 0.4;
    sum += acc === null ? build : 0.5 * build + 0.5 * acc;
    parts.push(`${m.id}: ${m.met ? `met in ${plural(m.attempts, 'check')} with ${plural(m.hintsUsed, 'hint')}` : 'not met'}${acc === null ? '' : `, ${Math.round(acc * 100)}% of questions right`}`);
  }
  const ratio = sum / targets.length;
  const qids = new Set(targets.flatMap((m) => m.questions.map((q) => q.id)));
  return {
    ...base('transfer'),
    score: band(ratio),
    basis: `${rules.builds ? 'Applying the model to a new case' : 'The whole-cell recap'}: ${parts.join('; ')}.`,
    evidence: cap(events.filter((e) => rules.transferMissions.includes(missionOf(e) ?? '') || qids.has(questionOf(e) ?? '')).map((e) => e.id)),
    measures: { transferMissions: targets.length, ratio: r2(ratio) },
  };
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function stats(t: MissionsTruth, rules: LabRules, events: EventRow[], sensor: SensorData | null, device: Device): { kind: Device; items: StatItem[] } {
  const think = t.missions.flatMap((m) => m.questions).map((q) => q.thinkMs).filter((n) => n > 0);
  const met = t.missions.filter((m) => m.met);
  const checks = met.reduce((s, m) => s + m.attempts, 0);
  const first = events[0]?.timestamp ?? 0;
  const last = events[events.length - 1]?.timestamp ?? first;
  const head = sensor ? travel(sensor, 'head', first, last) : null;
  const hand = sensor ? travel(sensor, 'hand', first, last) : null;
  const sec = (ms: number | null) => (ms === null ? '–' : `${r1(ms / 1000)}s`);
  const m = (v: number | null) => (v === null ? '–' : `${r2(v)} m`);
  const common: StatItem[] = [
    { label: 'Missions done', value: `${met.length}`, hint: 'Missions whose goal was met' },
    { label: 'Hints used', value: `${t.missions.reduce((s, x) => s + x.hintsUsed, 0)}`, hint: 'Nudges, clues and explanations asked for' },
    { label: 'Time per question', value: sec(median(think)), hint: 'Median time from seeing a checkpoint question to answering it' },
  ];
  if (rules.builds) common.push({ label: 'Checks per mission', value: met.length ? `${r1(checks / met.length)}` : '–', hint: 'How many times a build was checked before it met the goal' });
  if (device === 'vr') return { kind: 'vr', items: [...common, { label: 'Head travel', value: m(head), hint: 'How much they moved around the model' }, { label: 'Hand travel', value: m(hand), hint: 'Controller / hand path across the session' }] };
  return { kind: device, items: [...common, { label: 'Camera movement', value: m(head), hint: 'How far they orbited the model' }, { label: 'Pointer travel', value: m(hand), hint: 'Mouse / touch path' }] };
}

export function scoreMissions(events: EventRow[], sensor: SensorData | null, device: Device, truth: TruthInfo | null, labType: MissionsLabType): Report {
  const rules = MISSION_LABS[labType];
  const t = truth?.missions && truth.missions.labType === labType ? truth.missions : missionsFromEvents(events, labType);
  const noChecks = 'Not part of this lab: chapters are completed by the journey, so there are no builds to check.';
  const dims: DimensionResult[] = [
    rules.builds ? predictionDiscipline(t, events) : notAssessed('predictionDiscipline', noChecks),
    retrievalEffort(t, events),
    rules.builds ? revisionQuality(t, events) : notAssessed('revisionQuality', noChecks),
    causalCoherence(t, events),
    rules.builds ? calibration(events) : notAssessed('metacognitiveCalibration', 'Not part of this lab: there are no checks or confidence ratings to compare with results.'),
    transfer(t, rules, events),
  ];
  const qs = t.missions.flatMap((m) => m.questions).filter((q) => q.answered);
  return {
    rubricVersion: `${RUBRIC_VERSION}-missions`,
    lessonType: labType,
    device,
    complete: t.submitted,
    dimensions: dims,
    overall: overall(dims, t.submitted, rules.assessable),
    deviceStats: stats(t, rules, events, sensor, device),
    metrics: {
      missionsMet: t.missions.filter((m) => m.met).length,
      checks: t.missions.reduce((s, m) => s + m.attempts, 0),
      hintsUsed: t.missions.reduce((s, m) => s + m.hintsUsed, 0),
      quizAnswered: qs.length,
      quizRight: qs.filter((q) => q.correct).length,
      fromServerRecord: !!truth?.missions,
      hasSensorData: sensor !== null,
    },
  };
}
