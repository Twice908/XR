import { action, cap, d, deviceStats, metacognition, num, pairActions, predictionDiscipline, r2, retrievalEffort } from './chemistry';
import { LABELS, RUBRIC_VERSION, type Device, type DimensionResult, type EventRow, type Report, type SensorData, type TruthInfo } from './types';

/*
 * Deterministic rubric for the Light: Reflection & Spherical Mirrors lab (0-3 per dimension).
 * Prediction discipline, retrieval effort and calibration share their logic with the other labs (each prediction is
 * paired with the action and the `test_result` that followed it). Revision, causal coherence and transfer read the
 * per-case results held by the lesson service, because only the server knows what the textbook table says.
 */

const FIELDS_PER_IMAGE = 4;

function revisionQuality(events: EventRow[], truth: TruthInfo | null): DimensionResult {
  const base = { key: 'revisionQuality' as const, label: LABELS.revisionQuality, max: 3 as const };
  const o = truth?.optics;
  const cases = o?.cases ?? [];
  if (!o || !o.submitted) return { ...base, score: null, basis: 'Not scored until the table is locked in.', evidence: [], measures: {} };
  const revisions = events.filter((e) => e.verb === 'revised_model');
  const need = cases.filter((c) => c.firstScore < FIELDS_PER_IMAGE);
  if (need.length === 0) {
    return { ...base, score: 3, basis: 'Every first prediction was already right, so there was nothing to revise.', evidence: cap(revisions.map((e) => e.id)), measures: { cases: cases.length, needed: 0 } };
  }
  const improved = need.filter((c) => (c.finalScore ?? 0) > c.firstScore).length;
  const worse = need.filter((c) => (c.finalScore ?? 0) < c.firstScore).length;
  const anomaly = cases.find((c) => c.anomaly);
  const anomalyFixed = anomaly ? anomaly.firstScore < FIELDS_PER_IMAGE && (anomaly.finalScore ?? 0) > anomaly.firstScore : false;
  const ratio = improved / need.length;
  const score = ratio >= 0.75 ? 3 : ratio >= 0.5 ? 2 : ratio > 0 ? 1 : 0;
  return {
    ...base,
    score,
    basis: `${need.length} of ${cases.length} first predictions had mistakes; ${improved} improved in the final table${worse ? ` and ${worse} got worse` : ''}${anomaly && anomaly.firstScore < FIELDS_PER_IMAGE ? `; the case at F was ${anomalyFixed ? 'corrected' : 'not corrected'}` : ''}.`,
    evidence: cap(revisions.map((e) => e.id)),
    measures: { cases: cases.length, needed: need.length, improved, worse, anomalyCorrected: anomalyFixed ? 'yes' : 'no' },
  };
}

/** An explanation counts when it is substantial and was not mostly pasted in. (The lesson service has already checked it drew on this run's own numbers.) */
const genuine = (g: { words: number; pasted: number }) => g.words >= 8 && g.pasted < 40;

function causalCoherence(events: EventRow[], truth: TruthInfo | null): DimensionResult {
  const base = { key: 'causalCoherence' as const, label: LABELS.causalCoherence, max: 3 as const };
  const o = truth?.optics;
  if (!o || !o.submitted || !o.cases.length) return { ...base, score: null, basis: 'Not scored until the table is locked in.', evidence: [], measures: {} };
  const finalAcc = o.cases.reduce((s, c) => s + (c.finalScore ?? 0), 0) / (o.cases.length * FIELDS_PER_IMAGE);
  const laws = o.laws ?? { correct: 0, total: 0 };
  const basicsTotal = o.plane.total + laws.total + o.rules.total;
  const basicsCorrect = o.plane.correct + laws.correct + o.rules.correct;
  const basicsAcc = basicsTotal ? basicsCorrect / basicsTotal : 0;
  const ex = o.explanations;
  const given = ex?.given ?? [];
  const real = given.filter(genuine);
  const required = ex?.required ?? 0;
  // Older sessions had optional explanations: fall back to what the browser reported.
  const legacy = events.filter((e) => e.verb === 'explained' && (num(d(e).words) ?? 0) >= 6).length;
  const explainedRatio = ex ? (required ? Math.min(1, real.length / required) : 1) : Math.min(1, legacy / 3);
  const blend = 0.5 * finalAcc + 0.15 * basicsAcc + 0.35 * explainedRatio;
  const score = blend >= 0.9 ? 3 : blend >= 0.65 ? 2 : blend >= 0.35 ? 1 : 0;
  const pasted = given.filter((g) => !genuine(g) && g.pasted >= 40).length;
  const voice = given.filter((g) => g.inputMode === 'voice').length;
  return {
    ...base,
    score,
    basis: `${Math.round(finalAcc * 100)}% of the final image table was right, ${basicsCorrect} of ${basicsTotal} surface, law and ray-rule predictions matched, and ${real.length} of ${required || 'the'} required explanations were the student's own${pasted ? ` (${pasted} looked pasted in and did not count)` : ''}${voice ? `; ${voice} spoken aloud` : ''}.`,
    evidence: cap(events.filter((e) => e.verb === 'explained').map((e) => e.id)),
    measures: { tableAccuracy: r2(finalAcc), basicsAccuracy: r2(basicsAcc), explanations: real.length, explanationsRequired: required, pastedExplanations: pastedCount(given), spokenExplanations: voice, blend: r2(blend) },
  };
}

const pastedCount = (given: { pasted: number }[]) => given.filter((g) => g.pasted >= 40).length;

/** Transfer: after learning the concave mirror, how well did the first convex predictions hold up? */
function transfer(truth: TruthInfo | null): DimensionResult {
  const base = { key: 'transfer' as const, label: LABELS.transfer, max: 3 as const };
  const convex = (truth?.optics?.cases ?? []).filter((c) => c.mirror === 'convex');
  if (!convex.length) return { ...base, score: null, basis: 'The convex mirror has not been tested yet.', evidence: [], measures: {} };
  const acc = convex.reduce((s, c) => s + c.firstScore, 0) / (convex.length * FIELDS_PER_IMAGE);
  const score = Math.round(acc * 3);
  return { ...base, score, basis: `Applied the concave-mirror rules to a new mirror: ${Math.round(acc * 100)}% of the first convex predictions were right.`, evidence: [], measures: { convexCases: convex.length, firstAttemptAccuracy: r2(acc) } };
}

export function scoreOptics(events: EventRow[], sensor: SensorData | null, device: Device, truth: TruthInfo | null = null): Report {
  const { pairs, unpredicted } = pairActions(events);
  const dims: DimensionResult[] = [
    predictionDiscipline(events, pairs, unpredicted),
    retrievalEffort(pairs, sensor, device),
    revisionQuality(events, truth),
    causalCoherence(events, truth),
    metacognition(events),
    transfer(truth),
  ];
  const given = truth?.optics?.explanations?.given ?? [];
  const stats = deviceStats(events, pairs, sensor, device);
  if (given.length) {
    const median = (xs: number[]) => (xs.length ? [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)] : 0);
    stats.items.push(
      { label: 'Explained aloud', value: `${given.filter((g) => g.inputMode === 'voice').length} of ${given.length}`, hint: 'Explanations spoken rather than typed' },
      { label: 'Pasted into the box', value: String(pastedCount(given)), hint: 'Explanations with 40 or more pasted characters' },
      { label: 'Time away from the tab', value: `${given.reduce((s, g) => s + g.blurs, 0)}×`, hint: 'Times the student left this tab while a run was open' },
      { label: 'Time with the result', value: `${r2(median(given.map((g) => g.dwellMs)) / 1000)}s`, hint: 'Median time between seeing a result and explaining it' },
    );
  }
  const assessed = dims.filter((x) => x.score !== null);
  const points = assessed.reduce((s, x) => s + (x.score as number), 0);
  const max = assessed.length * 3;
  return {
    rubricVersion: `${RUBRIC_VERSION}-optics`,
    lessonType: 'physics_optics',
    device,
    complete: truth?.optics?.submitted === true,
    dimensions: dims,
    overall: { points, max, percent: max ? Math.round((points / max) * 100) : null },
    deviceStats: stats,
    metrics: {
      predictionsMade: events.filter((e) => e.verb === 'predicted').length,
      actionsMade: events.filter((e) => e.verb === 'acted').length,
      revisions: events.filter((e) => e.verb === 'revised_model').length,
      anomalyNoticed: events.some((e) => e.verb === 'noticed_anomaly'),
      explanations: given.length,
      pastedExplanations: pastedCount(given),
      spokenExplanations: given.filter((g) => g.inputMode === 'voice').length,
      hasSensorData: sensor !== null,
    },
  };
}
