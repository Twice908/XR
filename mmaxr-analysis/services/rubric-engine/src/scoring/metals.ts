import {
  action,
  cap,
  d,
  deviceStats,
  metacognition,
  pairActions,
  predictionDiscipline,
  r2,
  retrievalEffort,
  revisionQuality,
  slotOf,
} from './chemistry';
import { LABELS, RUBRIC_VERSION, type Device, type DimensionResult, type EventRow, type Report, type SensorData, type TruthInfo } from './types';

/*
 * Deterministic rubric for the Metals & Non-Metals lab (0-3 per dimension). Prediction discipline, retrieval effort,
 * revision quality and calibration share their logic with the indicators lab; causal coherence is specific to this lab.
 */

/** Outcomes that point towards "metal". Oxygen and water are not counted: they say more about reactivity than type. */
const METALLIC: Record<string, string[]> = {
  hammer: ['flattens'],
  wire: ['draws'],
  tap: ['rings'],
  circuit: ['glows'],
  heat: ['conducts_well'],
};

const metals = (events: EventRow[]) => events.filter((e) => action(e) === 'test_result');

function causalCoherence(events: EventRow[], truth: TruthInfo | null): DimensionResult {
  const base = { key: 'causalCoherence' as const, label: LABELS.causalCoherence, max: 3 as const };
  const sub = truth?.submission;
  if (!truth || !sub) {
    return { ...base, score: null, basis: 'Not scored until the analysis is submitted.', evidence: [], measures: {} };
  }
  const n = truth.tubes.length || 1;
  let right = 0;
  let consistent = 0;
  for (const t of truth.tubes) {
    const said = sub.tubes.find((x) => x.tube === t.tube)?.conclusion ?? null;
    if (said === t.type) right++;
    const results = metals(events).filter((e) => slotOf(e) === t.tube);
    const votes = results
      .map((e) => ({ tool: String(d(e).tool), out: String(e.object_data?.value) }))
      .filter((v) => METALLIC[v.tool])
      .map((v) => (METALLIC[v.tool].includes(v.out) ? 'metal' : 'non-metal'));
    const metalVotes = votes.filter((v) => v === 'metal').length;
    const nonVotes = votes.length - metalVotes;
    const majorityAgrees = votes.length === 0 || metalVotes === nonVotes || (metalVotes > nonVotes ? 'metal' : 'non-metal') === said;
    // A conclusion is supported when it rests on at least two tests and follows what the student's own results mostly say.
    if (said !== null && results.length >= 2 && majorityAgrees) consistent++;
  }
  const blend = 0.6 * (right / n) + 0.4 * (consistent / n);
  const score = blend >= 0.9 ? 3 : blend >= 0.65 ? 2 : blend >= 0.35 ? 1 : 0;
  return {
    ...base,
    score,
    basis: `${right}/${n} samples identified correctly, and ${consistent}/${n} conclusions rest on at least two tests that mostly agree with them.`,
    evidence: cap(metals(events).map((e) => e.id)),
    measures: { samples: n, correct: right, supported: consistent, blend: r2(blend) },
  };
}

export function scoreMetals(events: EventRow[], sensor: SensorData | null, device: Device, truth: TruthInfo | null = null): Report {
  const { pairs, unpredicted } = pairActions(events);
  const dims: DimensionResult[] = [
    predictionDiscipline(events, pairs, unpredicted),
    retrievalEffort(pairs, sensor, device),
    revisionQuality(events, truth),
    causalCoherence(events, truth),
    metacognition(events),
    { key: 'transfer', label: LABELS.transfer, score: null, max: 3, basis: 'This lab has no transfer task.', evidence: [], measures: {} },
  ];
  const assessed = dims.filter((x) => x.score !== null);
  const points = assessed.reduce((s, x) => s + (x.score as number), 0);
  const max = assessed.length * 3;
  const used = events.filter((e) => e.verb === 'acted').length;
  return {
    rubricVersion: `${RUBRIC_VERSION}-metals`,
    lessonType: 'chemistry_metals',
    device,
    complete: truth?.submission != null,
    dimensions: dims,
    overall: { points, max, percent: max ? Math.round((points / max) * 100) : null },
    deviceStats: deviceStats(events, pairs, sensor, device),
    metrics: {
      predictionsMade: events.filter((e) => e.verb === 'predicted').length,
      actionsMade: used,
      testsUsed: used,
      revisions: events.filter((e) => e.verb === 'revised_model').length,
      hasSensorData: sensor !== null,
    },
  };
}
