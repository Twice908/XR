import { r1, r2 } from './chemistry';
import { travel } from './sensors';
import { band, BIOLOGY_DIMENSIONS, overall } from './rules';
import { LABELS, RUBRIC_VERSION, type Device, type DimensionKey, type DimensionResult, type EventRow, type Report, type SensorData, type StatItem, type TruthInfo } from './types';

/*
 * Deterministic rubric for the biology journeys (0-3 per dimension).
 * The lab is a view-only tour followed by a short quiz and a closing explanation, so there are no predictions,
 * confidence ratings or revisions to judge. Two dimensions are assessed from the server-held results:
 *  - causal coherence: how many of the dealt quiz questions were answered right;
 *  - transfer: how much of the whole pathway the closing explanation covered.
 * The others are left unassessed rather than invented.
 */

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const notAssessed = (key: DimensionKey): DimensionResult => ({ key, label: LABELS[key], score: null, max: 3, basis: 'Not part of this lab: it has no predictions to lock in, so there is nothing to judge here.', evidence: [], measures: {} });

function causalCoherence(truth: TruthInfo | null): DimensionResult {
  const base = { key: 'causalCoherence' as const, label: LABELS.causalCoherence, max: 3 as const };
  const b = truth?.biology;
  if (!b || b.quiz.length === 0) return { ...base, score: null, basis: 'The quiz has not been answered yet.', evidence: [], measures: {} };
  const right = b.quiz.filter((q) => q.correct).length;
  const ratio = right / b.quiz.length;
  const score = band(ratio);
  const missed = b.quiz.filter((q) => !q.correct).map((q) => q.organ);
  return {
    ...base,
    score,
    basis: `${right} of ${b.quiz.length} quiz question${b.quiz.length > 1 ? 's' : ''} right${missed.length ? `; missed: ${missed.join(', ')}` : ''}.`,
    evidence: [],
    measures: { right, asked: b.quiz.length, accuracy: r2(ratio) },
  };
}

function transfer(truth: TruthInfo | null): DimensionResult {
  const base = { key: 'transfer' as const, label: LABELS.transfer, max: 3 as const };
  const fin = truth?.biology?.final;
  if (!fin) return { ...base, score: null, basis: 'The closing explanation has not been submitted.', evidence: [], measures: {} };
  if (typeof fin.explainCoverage !== 'number') return { ...base, score: null, basis: 'This lab has no closing explanation to judge.', evidence: [], measures: {} };
  const score = band(fin.explainCoverage);
  return { ...base, score, basis: `The closing explanation of the whole pathway covered ${Math.round(fin.explainCoverage * 100)}% of the key ideas.`, evidence: [], measures: { explainCoverage: r2(fin.explainCoverage) } };
}

function stats(events: EventRow[], truth: TruthInfo | null, sensor: SensorData | null, device: Device): { kind: Device; items: StatItem[] } {
  const quiz = truth?.biology?.quiz ?? [];
  const think = quiz.map((q) => q.thinkMs).filter((n) => n > 0);
  const fin = truth?.biology?.final;
  const first = events[0]?.timestamp ?? 0;
  const last = events[events.length - 1]?.timestamp ?? first;
  const head = sensor ? travel(sensor, 'head', first, last) : null;
  const hand = sensor ? travel(sensor, 'hand', first, last) : null;
  const sec = (ms: number | null) => (ms === null ? '–' : `${r1(ms / 1000)}s`);
  const m = (v: number | null) => (v === null ? '–' : `${r2(v)} m`);
  const common: StatItem[] = [
    { label: 'Time per question', value: sec(median(think)), hint: 'Median time from seeing a quiz question to checking the answer' },
    { label: 'Explained aloud', value: fin?.inputMode === 'voice' ? 'Yes' : fin ? 'Typed' : '–', hint: 'Whether the closing explanation was spoken or typed' },
    { label: 'Spoken explanation', value: sec(fin?.speakMs ? fin.speakMs : null), hint: 'Length of the recorded closing explanation' },
  ];
  if (device === 'vr') {
    return { kind: 'vr', items: [...common, { label: 'Head travel', value: m(head), hint: 'How much they moved to look at each organ' }, { label: 'Hand travel', value: m(hand), hint: 'Controller / hand path across the whole journey' }, { label: 'Eye gaze', value: 'Not recorded', hint: 'Gaze on the organ needs an eye-tracking headset' }] };
  }
  return { kind: device, items: [...common, { label: 'Camera movement', value: m(head), hint: 'How far they orbited the model' }, { label: 'Pointer travel', value: m(hand), hint: 'Mouse / touch path' }] };
}

export function scoreBiology(events: EventRow[], sensor: SensorData | null, device: Device, truth: TruthInfo | null = null, lessonType: 'biology_digestive_system' | 'biology_respiratory_system' = 'biology_digestive_system'): Report {
  const dims: DimensionResult[] = [notAssessed('predictionDiscipline'), notAssessed('retrievalEffort'), notAssessed('revisionQuality'), causalCoherence(truth), notAssessed('metacognitiveCalibration'), transfer(truth)];
  const b = truth?.biology;
  return {
    rubricVersion: `${RUBRIC_VERSION}-biology`,
    lessonType,
    device,
    complete: b?.final != null,
    dimensions: dims,
    overall: overall(dims, b?.final != null, BIOLOGY_DIMENSIONS),
    deviceStats: stats(events, truth, sensor, device),
    metrics: {
      stopsVisited: b?.visited ?? 0,
      quizAnswered: b?.quiz.length ?? 0,
      quizRight: b?.quiz.filter((q) => q.correct).length ?? 0,
      voiceExplanations: b?.final?.inputMode === 'voice' ? 1 : 0,
      hasSensorData: sensor !== null,
    },
  };
}
