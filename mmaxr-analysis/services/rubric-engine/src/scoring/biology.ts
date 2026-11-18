import {
  cap,
  metacognition,
  pairActions,
  predictionDiscipline,
  r1,
  r2,
  retrievalEffort,
} from './chemistry';
import { travel } from './sensors';
import { LABELS, RUBRIC_VERSION, type Device, type DimensionResult, type EventRow, type Report, type SensorData, type StatItem, type TruthInfo } from './types';

/*
 * Deterministic rubric for the digestive-system journey (0-3 per dimension).
 * Prediction discipline, retrieval effort and calibration share their logic with the other labs; revision, causal
 * coherence and transfer are specific to this journey and read the per-stop results held by the lesson service.
 */

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function revisionQuality(events: EventRow[], truth: TruthInfo | null): DimensionResult {
  const base = { key: 'revisionQuality' as const, label: LABELS.revisionQuality, max: 3 as const };
  const stops = truth?.biology?.checkpoints ?? [];
  if (!stops.length) return { ...base, score: null, basis: 'No stops answered yet.', evidence: [], measures: {} };
  const need = stops.filter((s) => s.coverageFirst < 0.8);
  const revisions = events.filter((e) => e.verb === 'revised_model');
  if (need.length === 0) {
    return { ...base, score: 3, basis: 'Every first explanation already covered the key ideas, so there was little to improve.', evidence: cap(revisions.map((e) => e.id)), measures: { stops: stops.length, needed: 0 } };
  }
  const improved = need.filter((s) => s.coverageFinal - s.coverageFirst >= 0.2).length;
  const tried = need.filter((s) => s.revisions > 0).length;
  const ratio = improved / need.length;
  const score = ratio >= 0.75 ? 3 : ratio >= 0.5 ? 2 : ratio > 0 ? 1 : 0;
  return {
    ...base,
    score,
    basis: `${need.length} first explanation${need.length > 1 ? 's' : ''} missed key ideas; ${tried} revised, ${improved} improved noticeably after seeing the reveal.`,
    evidence: cap(revisions.map((e) => e.id)),
    measures: { stops: stops.length, needed: need.length, revised: tried, improved },
  };
}

function causalCoherence(truth: TruthInfo | null): DimensionResult {
  const base = { key: 'causalCoherence' as const, label: LABELS.causalCoherence, max: 3 as const };
  const stops = truth?.biology?.checkpoints ?? [];
  if (!stops.length) return { ...base, score: null, basis: 'No stops answered yet.', evidence: [], measures: {} };
  const cov = avg(stops.map((s) => s.coverageFirst));
  const sel = avg(stops.map((s) => (s.selection.glands + s.selection.juices + s.selection.nutrients) / 3));
  const blend = 0.6 * cov + 0.4 * sel;
  const score = blend >= 0.9 ? 3 : blend >= 0.65 ? 2 : blend >= 0.35 ? 1 : 0;
  return {
    ...base,
    score,
    basis: `First explanations covered ${Math.round(cov * 100)}% of the key ideas and the predicted glands, juices and nutrients were ${Math.round(sel * 100)}% right, across ${stops.length} stop${stops.length > 1 ? 's' : ''}.`,
    evidence: [],
    measures: { stops: stops.length, keyIdeas: r2(cov), selections: r2(sel), blend: r2(blend) },
  };
}

function transfer(truth: TruthInfo | null): DimensionResult {
  const base = { key: 'transfer' as const, label: LABELS.transfer, max: 3 as const };
  const fin = truth?.biology?.final;
  if (!fin) return { ...base, score: null, basis: 'The "what if?" challenge has not been submitted.', evidence: [], measures: {} };
  const score = fin.total ? Math.round((fin.correct / fin.total) * 3) : 0;
  return { ...base, score, basis: `Applied the journey to new situations: ${fin.correct} of ${fin.total} “what if?” questions right.`, evidence: [], measures: { correct: fin.correct, total: fin.total } };
}

function stats(events: EventRow[], truth: TruthInfo | null, sensor: SensorData | null, device: Device): { kind: Device; items: StatItem[] } {
  const stops = truth?.biology?.checkpoints ?? [];
  const think = stops.map((s) => s.thinkMs).filter((n) => n > 0);
  const voice = stops.filter((s) => s.inputMode === 'voice');
  const speak = voice.map((s) => s.speakMs);
  const first = events[0]?.timestamp ?? 0;
  const last = events[events.length - 1]?.timestamp ?? first;
  const head = sensor ? travel(sensor, 'head', first, last) : null;
  const hand = sensor ? travel(sensor, 'hand', first, last) : null;
  const sec = (ms: number | null) => (ms === null ? '–' : `${r1(ms / 1000)}s`);
  const m = (v: number | null) => (v === null ? '–' : `${r2(v)} m`);
  const common: StatItem[] = [
    { label: 'Time to decide', value: sec(median(think)), hint: 'Median time from arriving at a stop to locking a prediction' },
    { label: 'Explained aloud', value: `${voice.length} of ${stops.length}`, hint: 'Stops explained by voice rather than typed' },
    { label: 'Average spoken explanation', value: sec(speak.length ? avg(speak) : null), hint: 'Length of recorded explanations' },
  ];
  if (device === 'vr') {
    return { kind: 'vr', items: [...common, { label: 'Head travel', value: m(head), hint: 'How much they moved to look at each organ' }, { label: 'Hand travel', value: m(hand), hint: 'Controller / hand path across the whole journey' }, { label: 'Eye gaze', value: 'Not recorded', hint: 'Gaze on the organ needs an eye-tracking headset' }] };
  }
  return { kind: device, items: [...common, { label: 'Camera movement', value: m(head), hint: 'How far they orbited the model' }, { label: 'Pointer travel', value: m(hand), hint: 'Mouse / touch path' }] };
}

export function scoreBiology(events: EventRow[], sensor: SensorData | null, device: Device, truth: TruthInfo | null = null): Report {
  const { pairs, unpredicted } = pairActions(events);
  const dims: DimensionResult[] = [
    predictionDiscipline(events, pairs, unpredicted),
    retrievalEffort(pairs, sensor, device),
    revisionQuality(events, truth),
    causalCoherence(truth),
    metacognition(events),
    transfer(truth),
  ];
  const assessed = dims.filter((x) => x.score !== null);
  const points = assessed.reduce((s, x) => s + (x.score as number), 0);
  const max = assessed.length * 3;
  const stops = truth?.biology?.checkpoints ?? [];
  return {
    rubricVersion: `${RUBRIC_VERSION}-biology`,
    lessonType: 'biology_digestive_system',
    device,
    complete: truth?.biology?.final != null,
    dimensions: dims,
    overall: { points, max, percent: max ? Math.round((points / max) * 100) : null },
    deviceStats: stats(events, truth, sensor, device),
    metrics: {
      predictionsMade: events.filter((e) => e.verb === 'predicted').length,
      stopsAnswered: stops.length,
      revisions: events.filter((e) => e.verb === 'revised_model').length,
      voiceExplanations: stops.filter((s) => s.inputMode === 'voice').length,
      hasSensorData: sensor !== null,
    },
  };
}

