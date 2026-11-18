import { travel } from './sensors';
import {
  LABELS,
  RUBRIC_VERSION,
  type Device,
  type DimensionKey,
  type DimensionResult,
  type EventRow,
  type Report,
  type SensorData,
  type StatItem,
  type TruthInfo,
} from './types';

/*
 * Deterministic rubric for the chemistry indicators lab (0-3 per dimension).
 * Pure functions of the events + sensor samples: no clock, network, randomness or learned weights.
 * Anything not recorded for a session is reported as null (not assessed), never guessed.
 */

const d = (e: EventRow) => (e.object_data?.data ?? {}) as Record<string, unknown>;
const action = (e: EventRow) => e.object_data?.action ?? '';
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const cap = (ids: number[], n = 8) => ids.slice(0, n);
const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Retrieval thresholds. A headset hand roams much further than a mouse pointer over the same bench. */
const MOVE_HIGH_M: Record<Device, number> = { web: 0.3, vr: 0.8, unknown: 0.3 };

interface Pair {
  predicted: EventRow;
  acted: EventRow;
  gapMs: number;
}

/** Match every action to the latest earlier prediction for the same tube and tool. */
function pairActions(events: EventRow[]): { pairs: Pair[]; unpredicted: EventRow[] } {
  const pairs: Pair[] = [];
  const unpredicted: EventRow[] = [];
  const open = new Map<string, EventRow>();
  for (const e of events) {
    if (e.verb === 'predicted') open.set(`${d(e).tube}:${d(e).tool}`, e);
    if (e.verb === 'acted') {
      const key = `${d(e).tube}:${d(e).tool}`;
      const p = open.get(key);
      if (p && p.timestamp <= e.timestamp) {
        pairs.push({ predicted: p, acted: e, gapMs: e.timestamp - p.timestamp });
        open.delete(key);
      } else unpredicted.push(e);
    }
  }
  return { pairs, unpredicted };
}

function predictionDiscipline(events: EventRow[], pairs: Pair[], unpredicted: EventRow[]): DimensionResult {
  const predictions = events.filter((e) => e.verb === 'predicted');
  const actions = events.filter((e) => e.verb === 'acted');
  const evidence = cap(predictions.map((e) => e.id));
  if (!actions.length) {
    return { key: 'predictionDiscipline', label: LABELS.predictionDiscipline, score: null, max: 3, basis: 'No tests were run yet.', evidence: [], measures: { predictions: predictions.length, actions: 0 } };
  }
  const coverage = pairs.length / actions.length;
  const decisions = predictions.map((e) => num(d(e).decisionMs)).filter((x): x is number => x !== null);
  const medianDecision = median(decisions);
  const matches = events.filter((e) => action(e) === 'liquid_color');
  const right = matches.filter((e) => d(e).match === true).length;
  const accuracy = matches.length ? right / matches.length : null;
  const colors = new Set(predictions.map((e) => String(e.object_data?.value ?? '').toLowerCase()));
  const sameColorEveryTime = predictions.length >= 4 && colors.size === 1;

  let score = 0;
  let basis: string;
  if (coverage < 0.5) {
    basis = `Only ${pairs.length} of ${actions.length} tests were preceded by a prediction.`;
  } else {
    score = 1;
    if (accuracy !== null && accuracy >= 0.4) score += 1; // predictions track reality: informed, not random
    if (medianDecision !== null && medianDecision >= 2000) score += 1; // took time to think
    if (sameColorEveryTime) score = Math.min(score, 1);
    basis =
      `Predicted before acting on ${pairs.length} of ${actions.length} tests; ` +
      `${accuracy === null ? 'accuracy unknown' : `${Math.round(accuracy * 100)}% of predictions matched`}; ` +
      `median ${medianDecision === null ? 'n/a' : `${r1(medianDecision / 1000)}s`} to decide` +
      (sameColorEveryTime ? '; the same colour every time reads as guessing.' : '.');
  }
  return {
    key: 'predictionDiscipline',
    label: LABELS.predictionDiscipline,
    score,
    max: 3,
    basis,
    evidence,
    measures: { predictions: predictions.length, actions: actions.length, unpredictedActions: unpredicted.length, accuracy: accuracy === null ? null : r2(accuracy), medianDecisionMs: medianDecision === null ? null : Math.round(medianDecision) },
  };
}

function retrievalEffort(pairs: Pair[], sensor: SensorData | null, device: Device): DimensionResult {
  if (!pairs.length) {
    return { key: 'retrievalEffort', label: LABELS.retrievalEffort, score: null, max: 3, basis: 'No predict-then-act pairs yet.', evidence: [], measures: {} };
  }
  const gap = mean(pairs.map((p) => p.gapMs)) ?? 0;
  const moves = sensor ? pairs.map((p) => travel(sensor, 'hand', p.predicted.timestamp, p.acted.timestamp)) : [];
  const move = mean(moves);
  const high = MOVE_HIGH_M[device];

  let score: number;
  let basis: string;
  if (move !== null) {
    const timePts = gap >= 3000 ? 2 : gap >= 1000 ? 1 : 0;
    const movePts = move >= high ? 1 : 0;
    score = Math.min(3, timePts + movePts);
    basis = `Between predicting and acting: ${r1(gap / 1000)}s on average and ${r2(move)} m of ${device === 'vr' ? 'hand' : 'pointer'} travel.`;
  } else {
    score = gap >= 4000 ? 3 : gap >= 2000 ? 2 : gap >= 700 ? 1 : 0;
    basis = `Between predicting and acting: ${r1(gap / 1000)}s on average. No sensor file was uploaded, so movement is not counted.`;
  }
  return {
    key: 'retrievalEffort',
    label: LABELS.retrievalEffort,
    score,
    max: 3,
    basis,
    evidence: cap(pairs.flatMap((p) => [p.predicted.id, p.acted.id])),
    measures: { avgPredictToActMs: Math.round(gap), avgHandTravelM: move === null ? null : r2(move), hasSensorData: sensor !== null ? 'yes' : 'no' },
  };
}

/** Is this conclusion right? Judged from server-held truth; older sessions fall back to flags the client once recorded. */
function judge(truth: TruthInfo | null, tube: number, said: unknown, legacy: unknown): boolean | null {
  const t = truth?.tubes.find((x) => x.tube === tube);
  if (t) return typeof said === 'string' ? said === t.type : null;
  return typeof legacy === 'boolean' ? legacy : null;
}

function revisionQuality(events: EventRow[], truth: TruthInfo | null): DimensionResult {
  const firsts = events.filter((e) => action(e) === 'set_conclusion');
  const revisions = events.filter((e) => e.verb === 'revised_model');
  if (!firsts.length) {
    return { key: 'revisionQuality', label: LABELS.revisionQuality, score: null, max: 3, basis: 'No conclusions yet.', evidence: [], measures: {} };
  }
  const judgedFirst = firsts.map((e) => judge(truth, Number(d(e).tube), e.object_data?.value, d(e).correct));
  if (judgedFirst.every((j) => j === null)) {
    return { key: 'revisionQuality', label: LABELS.revisionQuality, score: null, max: 3, basis: 'The answers were not available to judge these conclusions.', evidence: [], measures: { firstConclusions: firsts.length } };
  }
  const wrongFirst = judgedFirst.filter((j) => j === false).length;
  const judged = revisions.map((e) => ({
    was: judge(truth, Number(d(e).tube), d(e).from, d(e).wasCorrect),
    now: judge(truth, Number(d(e).tube), d(e).to, d(e).nowCorrect),
  }));
  const improved = judged.filter((j) => j.was === false && j.now === true).length;
  const harmful = judged.filter((j) => j.was === true && j.now === false).length;

  let score: number;
  let basis: string;
  if (wrongFirst === 0) {
    score = harmful === 0 ? 3 : Math.max(0, 3 - harmful);
    basis = harmful === 0 ? 'First conclusions were all right, and none were talked out of.' : `First conclusions were right, but ${harmful} were changed to wrong ones.`;
  } else {
    const ratio = improved / wrongFirst;
    score = ratio >= 1 ? 3 : ratio >= 0.5 ? 2 : ratio > 0 ? 1 : 0;
    score = Math.max(0, score - harmful);
    basis = `${wrongFirst} first conclusion${wrongFirst > 1 ? 's were' : ' was'} wrong; ${improved} corrected after new evidence${harmful ? `, ${harmful} made worse` : ''}.`;
  }
  return {
    key: 'revisionQuality',
    label: LABELS.revisionQuality,
    score,
    max: 3,
    basis,
    evidence: cap([...revisions, ...firsts].map((e) => e.id)),
    measures: { firstConclusions: firsts.length, wrongFirst, revisions: revisions.length, improved, harmful },
  };
}

interface FinalTube {
  conclusion: string | null;
  truth: string;
  recordedPh: number | null;
  actualPh: number | null;
}

function submitted(events: EventRow[], truth: TruthInfo | null): { event: EventRow | null; tubes: FinalTube[] } | null {
  const e = [...events].reverse().find((x) => action(x) === 'submit_analysis') ?? null;
  // Preferred: what the server locked in, scored against what the server holds.
  if (truth?.submission) {
    const sub = truth.submission;
    return {
      event: e,
      tubes: truth.tubes.map((t) => {
        const s = sub.tubes.find((x) => x.tube === t.tube);
        return { conclusion: s?.conclusion ?? null, truth: t.type, recordedPh: s?.ph ?? null, actualPh: t.ph };
      }),
    };
  }
  if (truth) return null; // the server has not seen a submission, whatever the browser claims
  // Older sessions recorded the truth inside the event itself.
  if (!e) return null;
  const raw = d(e).tubes;
  if (!Array.isArray(raw)) return null;
  return {
    event: e,
    tubes: raw
      .filter((t: Record<string, unknown>) => typeof t.truth === 'string')
      .map((t: Record<string, unknown>) => ({
        conclusion: typeof t.conclusion === 'string' ? t.conclusion : null,
        truth: String(t.truth),
        recordedPh: num(t.recordedPh),
        actualPh: num(t.actualPh),
      })),
  };
}

/** Does the written pH agree with what the student called the liquid? */
const consistent = (conclusion: string | null, ph: number | null) => {
  if (conclusion === null || ph === null) return false;
  if (conclusion === 'acid') return ph < 7;
  if (conclusion === 'base') return ph > 7;
  return ph >= 6 && ph <= 8;
};

function causalCoherence(events: EventRow[], truth: TruthInfo | null): DimensionResult {
  const fin = submitted(events, truth);
  if (!fin || fin.tubes.length === 0) {
    return { key: 'causalCoherence', label: LABELS.causalCoherence, score: null, max: 3, basis: 'Not scored until the analysis is submitted.', evidence: [], measures: {} };
  }
  const n = fin.tubes.length || 1;
  const right = fin.tubes.filter((t) => t.conclusion === t.truth).length;
  const phNear = fin.tubes.filter((t) => t.recordedPh !== null && t.actualPh !== null && Math.abs(t.recordedPh - t.actualPh) <= 1).length;
  const coherent = fin.tubes.filter((t) => consistent(t.conclusion, t.recordedPh)).length;
  const blend = 0.5 * (right / n) + 0.25 * (phNear / n) + 0.25 * (coherent / n);
  const score = blend >= 0.9 ? 3 : blend >= 0.65 ? 2 : blend >= 0.35 ? 1 : 0;
  return {
    key: 'causalCoherence',
    label: LABELS.causalCoherence,
    score,
    max: 3,
    basis: `${right}/${n} tubes identified correctly, ${phNear}/${n} pH values within 1, and ${coherent}/${n} conclusions agree with the student's own pH.`,
    evidence: fin.event ? [fin.event.id] : [],
    measures: { tubes: n, correct: right, phWithinOne: phNear, selfConsistent: coherent, blend: r2(blend) },
  };
}

/** Confidence 1-3 against how often predictions were right. */
const EXPECTED_ACCURACY: Record<number, number> = { 1: 0.33, 2: 0.66, 3: 0.9 };

function metacognition(events: EventRow[]): DimensionResult {
  const preds = events.filter((e) => e.verb === 'predicted');
  const outcome = new Map<string, boolean>();
  for (const e of events) if (action(e) === 'liquid_color') outcome.set(`${d(e).tube}:${d(e).tool}`, d(e).match === true);
  const scored = preds
    .map((p) => ({ p, conf: num(d(p).confidence), right: outcome.get(`${d(p).tube}:${d(p).tool}`) }))
    .filter((x): x is { p: EventRow; conf: number; right: boolean } => x.conf !== null && x.right !== undefined);
  if (scored.length < 3) {
    return { key: 'metacognitiveCalibration', label: LABELS.metacognitiveCalibration, score: null, max: 3, basis: 'Needs at least 3 predictions with a confidence rating.', evidence: [], measures: { rated: scored.length } };
  }
  const err = mean(scored.map((x) => Math.abs((EXPECTED_ACCURACY[x.conf] ?? 0.5) - (x.right ? 1 : 0)))) ?? 1;
  const confidentWrong = scored.filter((x) => x.conf === 3 && !x.right).length;
  const score = err <= 0.35 ? 3 : err <= 0.5 ? 2 : err <= 0.62 ? 1 : 0;
  return {
    key: 'metacognitiveCalibration',
    label: LABELS.metacognitiveCalibration,
    score,
    max: 3,
    basis: `Confidence matched outcomes with an average gap of ${r2(err)} over ${scored.length} predictions; ${confidentWrong} “certain” prediction${confidentWrong === 1 ? ' was' : 's were'} wrong.`,
    evidence: cap(scored.map((x) => x.p.id)),
    measures: { rated: scored.length, calibrationGap: r2(err), confidentWrong },
  };
}

function deviceStats(events: EventRow[], pairs: Pair[], sensor: SensorData | null, device: Device): { kind: Device; items: StatItem[] } {
  const first = events[0]?.timestamp ?? 0;
  const last = events[events.length - 1]?.timestamp ?? first;
  const decisions = events.filter((e) => e.verb === 'predicted').map((e) => num(d(e).decisionMs)).filter((x): x is number => x !== null);
  const gap = mean(pairs.map((p) => p.gapMs));
  const handDuring = sensor ? mean(pairs.map((p) => travel(sensor, 'hand', p.predicted.timestamp, p.acted.timestamp))) : null;
  const headTotal = sensor ? travel(sensor, 'head', first, last) : null;
  const handTotal = sensor ? travel(sensor, 'hand', first, last) : null;
  const sec = (ms: number | null) => (ms === null ? '–' : `${r1(ms / 1000)}s`);
  const m = (v: number | null) => (v === null ? '–' : `${r2(v)} m`);
  const entries = events.filter((e) => ['record_color', 'record_ph'].includes(action(e))).length;

  if (device === 'vr') {
    return {
      kind: 'vr',
      items: [
        { label: 'Hand travel while deciding', value: m(handDuring), hint: 'Controller / hand path between predicting and acting' },
        { label: 'Hand travel overall', value: m(handTotal), hint: 'Whole session' },
        { label: 'Head travel', value: m(headTotal), hint: 'How much they moved around the bench' },
        { label: 'Time to act', value: sec(gap), hint: 'Prediction to action, average' },
        { label: 'Eye gaze', value: 'Not recorded', hint: 'Gaze dwell needs an eye-tracking headset' },
      ],
    };
  }
  return {
    kind: device,
    items: [
      { label: 'Time to decide', value: sec(median(decisions)), hint: 'Median time on the prediction dialog' },
      { label: 'Time to act', value: sec(gap), hint: 'Prediction to dropper, average' },
      { label: 'Pointer travel while deciding', value: m(handDuring), hint: 'Mouse / touch path over the bench' },
      { label: 'Camera movement', value: m(headTotal), hint: 'How far they orbited the bench' },
      { label: 'Notebook entries', value: String(entries), hint: 'Colours and pH values written down' },
    ],
  };
}

export function scoreChemistry(events: EventRow[], sensor: SensorData | null, device: Device, truth: TruthInfo | null = null): Report {
  const { pairs, unpredicted } = pairActions(events);
  const dims: DimensionResult[] = [
    predictionDiscipline(events, pairs, unpredicted),
    retrievalEffort(pairs, sensor, device),
    revisionQuality(events, truth),
    causalCoherence(events, truth),
    metacognition(events),
    { key: 'transfer' as DimensionKey, label: LABELS.transfer, score: null, max: 3, basis: 'This lab has no transfer task.', evidence: [], measures: {} },
  ];
  const assessed = dims.filter((x) => x.score !== null);
  const points = assessed.reduce((s, x) => s + (x.score as number), 0);
  const max = assessed.length * 3;
  const complete = submitted(events, truth) !== null;
  return {
    rubricVersion: RUBRIC_VERSION,
    lessonType: 'chemistry_indicators',
    device,
    complete,
    dimensions: dims,
    overall: { points, max, percent: max ? Math.round((points / max) * 100) : null },
    deviceStats: deviceStats(events, pairs, sensor, device),
    metrics: {
      predictionsMade: events.filter((e) => e.verb === 'predicted').length,
      actionsMade: events.filter((e) => e.verb === 'acted').length,
      revisions: events.filter((e) => e.verb === 'revised_model').length,
      hasSensorData: sensor !== null,
    },
  };
}
