import { cap, metacognition, pairActions, predictionDiscipline, r1, r2, retrievalEffort } from './chemistry';
import { travel } from './sensors';
import { ALL_DIMENSIONS, band, BANDS, overall } from './rules';
import { LABELS, RUBRIC_VERSION, type Device, type DimensionResult, type EventRow, type Report, type SensorData, type StatItem, type TruthInfo } from './types';

/*
 * Deterministic rubric for the motion, forces and gravitation sandbox (0-3 per dimension).
 * Prediction discipline, retrieval effort and calibration share their logic with the other labs. Revision, causal
 * coherence and transfer read the per-trial results held by the lesson service.
 */

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type T = NonNullable<TruthInfo['motion']>['trials'][number];
const trialsOf = (truth: TruthInfo | null): T[] => truth?.motion?.trials ?? [];

/** After a wrong prediction, did the student learn from it? Judged by the explanation, or by doing better next time in the module. */
function revisionQuality(events: EventRow[], truth: TruthInfo | null): DimensionResult {
  const base = { key: 'revisionQuality' as const, label: LABELS.revisionQuality, max: 3 as const };
  const all = trialsOf(truth).filter((t) => t.kind === 'prediction');
  if (!all.length) return { ...base, score: null, basis: 'No predictions yet.', evidence: [], measures: { trials: 0 } };
  const surprised = all.filter((t) => !t.match);
  const evidence = cap(events.filter((e) => e.object_data?.action === 'explain_result').map((e) => e.id));
  if (!surprised.length) return { ...base, score: 3, basis: 'Every prediction matched, so there was nothing to revise.', evidence, measures: { trials: all.length, surprised: 0 } };
  const credit = surprised.map((t) => {
    if (t.coverage !== null) return t.coverage >= 0.6 ? 1 : t.coverage >= 0.3 ? 0.5 : 0;
    const next = all.filter((x) => x.scenario === t.scenario && x.n > t.n)[0];
    return next ? (next.match ? 1 : 0) : 0.5;
  });
  const ratio = avg(credit);
  const score = band(ratio);
  return { ...base, score, basis: `${surprised.length} prediction${surprised.length > 1 ? 's' : ''} did not match; after seeing the result they ${ratio >= BANDS.three ? 'explained or corrected nearly all of them' : ratio >= BANDS.two ? 'explained or corrected most of them' : ratio >= BANDS.one ? 'explained or corrected some of them' : 'rarely explained or corrected them'}.`, evidence, measures: { trials: all.length, surprised: surprised.length, learned: r2(ratio) } };
}

function causalCoherence(truth: TruthInfo | null): DimensionResult {
  const base = { key: 'causalCoherence' as const, label: LABELS.causalCoherence, max: 3 as const };
  const ex = trialsOf(truth).filter((t) => t.coverage !== null);
  if (!ex.length) return { ...base, score: null, basis: 'No explanations written yet.', evidence: [], measures: {} };
  const cov = avg(ex.map((t) => t.coverage as number));
  const score = band(cov);
  return { ...base, score, basis: `Explanations of the surprising results covered ${Math.round(cov * 100)}% of the key ideas across ${ex.length} ${ex.length > 1 ? 'explanations' : 'explanation'}.`, evidence: [], measures: { explanations: ex.length, keyIdeas: r2(cov), avgWords: Math.round(avg(ex.map((t) => t.words))) } };
}

function transfer(truth: TruthInfo | null): DimensionResult {
  const base = { key: 'transfer' as const, label: LABELS.transfer, max: 3 as const };
  const tr = trialsOf(truth).filter((t) => t.kind === 'transfer');
  if (!tr.length) return { ...base, score: null, basis: 'No “what if?” questions answered yet.', evidence: [], measures: {} };
  const right = tr.filter((t) => t.match).length;
  return { ...base, score: band(right / tr.length), basis: `Applied the ideas to new situations: ${right} of ${tr.length} “what if?” question${tr.length > 1 ? 's' : ''} right.`, evidence: [], measures: { correct: right, answered: tr.length } };
}

function stats(truth: TruthInfo | null, events: EventRow[], sensor: SensorData | null, device: Device): { kind: Device; items: StatItem[] } {
  const ts = trialsOf(truth);
  const think = ts.map((t) => t.thinkMs).filter((n) => n > 0);
  const anomalies = ts.filter((t) => t.anomaly);
  const first = events[0]?.timestamp ?? 0;
  const last = events[events.length - 1]?.timestamp ?? first;
  const head = sensor ? travel(sensor, 'head', first, last) : null;
  const hand = sensor ? travel(sensor, 'hand', first, last) : null;
  const m = (v: number | null) => (v === null ? '–' : `${r2(v)} m`);
  const md = median(think);
  const explained = ts.filter((t) => t.coverage !== null);
  const aloud = explained.filter((t) => t.inputMode === 'voice');
  const common: StatItem[] = [
    { label: 'Time to decide', value: md === null ? '–' : `${r1(md / 1000)}s`, hint: 'Median time from reading a question to locking a prediction' },
    { label: 'Explained aloud', value: `${aloud.length} of ${explained.length}`, hint: 'Explanations spoken rather than typed' },
    { label: 'Surprises predicted', value: `${anomalies.filter((t) => t.match).length} of ${anomalies.length}`, hint: 'The counter-intuitive results the student called correctly' },
  ];
  if (device === 'vr') return { kind: 'vr', items: [...common, { label: 'Head travel', value: m(head), hint: 'How much they moved to watch each experiment' }, { label: 'Hand travel', value: m(hand), hint: 'Controller / hand path' }, { label: 'Eye gaze', value: 'Not recorded', hint: 'Gaze on the moving object needs an eye-tracking headset' }] };
  return { kind: device, items: [...common, { label: 'Camera movement', value: m(head), hint: 'How far they orbited the scene' }, { label: 'Pointer travel', value: m(hand), hint: 'Mouse / touch path' }] };
}

export function scoreMotion(events: EventRow[], sensor: SensorData | null, device: Device, truth: TruthInfo | null = null): Report {
  const { pairs, unpredicted } = pairActions(events);
  const dims: DimensionResult[] = [
    predictionDiscipline(events, pairs, unpredicted),
    retrievalEffort(pairs, sensor, device),
    revisionQuality(events, truth),
    causalCoherence(truth),
    metacognition(events),
    transfer(truth),
  ];
  const ts = trialsOf(truth);
  const total = truth?.motion?.total ?? 0;
  const complete = total > 0 && ts.length >= total;
  return {
    rubricVersion: `${RUBRIC_VERSION}-motion`,
    lessonType: 'physics_motion',
    device,
    complete,
    dimensions: dims,
    overall: overall(dims, complete, ALL_DIMENSIONS),
    deviceStats: stats(truth, events, sensor, device),
    metrics: {
      predictionsMade: events.filter((e) => e.verb === 'predicted').length,
      trialsFinished: ts.length,
      matched: ts.filter((t) => t.match).length,
      explanations: ts.filter((t) => t.coverage !== null).length,
      hasSensorData: sensor !== null,
    },
  };
}
