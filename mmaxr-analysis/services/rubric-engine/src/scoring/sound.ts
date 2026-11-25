import { cap, deviceStats, metacognition, pairActions, predictionDiscipline, r2, retrievalEffort } from './chemistry';
import { ALL_DIMENSIONS, band, overall } from './rules';
import { LABELS, RUBRIC_VERSION, type Device, type DimensionResult, type EventRow, type Report, type SensorData, type TruthInfo } from './types';

/*
 * Deterministic rubric for the Sound & Waves sandbox (0-3 per dimension). Prediction discipline, retrieval effort and
 * calibration share their logic with the other labs (each prediction is paired with the run and the `test_result`
 * that followed). Revision, causal coherence and transfer read the per-task results held by the lesson service.
 */

const genuine = (g: { words: number; pasted: number }) => g.words >= 8 && g.pasted < 40;
const pastedCount = (given: { pasted: number }[]) => given.filter((g) => g.pasted >= 40).length;

function revisionQuality(events: EventRow[], truth: TruthInfo | null): DimensionResult {
  const base = { key: 'revisionQuality' as const, label: LABELS.revisionQuality, max: 3 as const };
  const s = truth?.sound;
  if (!s || !s.submitted) return { ...base, score: null, basis: 'Not scored until every task is finished.', evidence: [], measures: {} };
  const given = s.explanations.given;
  const noticed = events.filter((e) => e.verb === 'noticed_anomaly');
  const wrong = s.tasks.filter((t) => !t.match);
  const slips = s.tasks.filter((t) => t.hasCalc && t.calcAttempts > 1);
  const opportunities = wrong.length + slips.length;
  if (opportunities === 0) return { ...base, score: 3, basis: 'Every prediction and calculation was right first time, so there was nothing to revise.', evidence: cap(noticed.map((e) => e.id)), measures: { wrong: 0, recalculated: 0 } };
  // A wrong prediction is handled when the student then explained it properly (and, for the anomaly, said they noticed it).
  const handledWrong = wrong.filter((t) => given.some((g) => g.id === t.id && genuine(g)) && (!t.anomaly || noticed.length > 0)).length;
  const handledSlips = slips.filter((t) => t.calcOk).length;
  const ratio = (handledWrong + handledSlips) / opportunities;
  const score = band(ratio);
  return {
    ...base,
    score,
    basis: `${wrong.length} wrong prediction${wrong.length === 1 ? '' : 's'} and ${slips.length} calculation${slips.length === 1 ? '' : 's'} needing more than one try; ${handledWrong} wrong prediction${handledWrong === 1 ? ' was' : 's were'} explained properly and ${handledSlips} calculation${handledSlips === 1 ? ' was' : 's were'} corrected${s.tasks.some((t) => t.anomaly && !t.match) ? (noticed.length ? '; the frequency anomaly was noticed' : '; the frequency anomaly was not flagged') : ''}.`,
    evidence: cap(noticed.map((e) => e.id)),
    measures: { wrong: wrong.length, recalculated: slips.length, handled: handledWrong + handledSlips },
  };
}

function causalCoherence(events: EventRow[], truth: TruthInfo | null): DimensionResult {
  const base = { key: 'causalCoherence' as const, label: LABELS.causalCoherence, max: 3 as const };
  const s = truth?.sound;
  if (!s || !s.submitted || !s.tasks.length) return { ...base, score: null, basis: 'Not scored until every task is finished.', evidence: [], measures: {} };
  const acc = s.tasks.filter((t) => t.match).length / s.tasks.length;
  const calcs = s.tasks.filter((t) => t.hasCalc);
  const calcFirst = calcs.length ? calcs.filter((t) => t.calcAttempts <= 1).length / calcs.length : 1;
  const given = s.explanations.given;
  const real = given.filter(genuine);
  const ratio = s.explanations.required ? Math.min(1, real.length / s.explanations.required) : 1;
  const blend = 0.4 * acc + 0.2 * calcFirst + 0.4 * ratio;
  const score = band(blend);
  const pasted = pastedCount(given);
  const voice = given.filter((g) => g.inputMode === 'voice').length;
  return {
    ...base,
    score,
    basis: `${s.tasks.filter((t) => t.match).length} of ${s.tasks.length} predictions matched, ${calcs.filter((t) => t.calcAttempts <= 1).length} of ${calcs.length} calculation${calcs.length === 1 ? '' : 's'} right first time, and ${real.length} of ${s.explanations.required} required explanations were the student's own${pasted ? ` (${pasted} looked pasted in and did not count)` : ''}${voice ? `; ${voice} spoken aloud` : ''}.`,
    evidence: cap(events.filter((e) => e.verb === 'explained').map((e) => e.id)),
    measures: { predictionAccuracy: r2(acc), calcFirstTry: r2(calcFirst), explanations: real.length, explanationsRequired: s.explanations.required, pastedExplanations: pasted, spokenExplanations: voice, blend: r2(blend) },
  };
}

/** Transfer: the same idea, distance = (speed × time) / 2, applied in air and then in water. */
function transfer(truth: TruthInfo | null): DimensionResult {
  const base = { key: 'transfer' as const, label: LABELS.transfer, max: 3 as const };
  const s = truth?.sound;
  const tasks = (s?.tasks ?? []).filter((t) => t.id === 'echo_2' || t.id === 'sonar_1');
  if (!tasks.length) return { ...base, score: null, basis: 'The echo and sonar tasks have not been done yet.', evidence: [], measures: {} };
  const right = tasks.filter((t) => t.match && (!t.hasCalc || t.calcAttempts <= 1)).length;
  const score = band(right / tasks.length);
  return { ...base, score, basis: `Applied “distance = (speed × time) / 2” to an echo in air and to sonar in water: ${right} of ${tasks.length} right first time.`, evidence: [], measures: { tasks: tasks.length, rightFirstTime: right } };
}

export function scoreSound(events: EventRow[], sensor: SensorData | null, device: Device, truth: TruthInfo | null = null): Report {
  const { pairs, unpredicted } = pairActions(events);
  const dims: DimensionResult[] = [predictionDiscipline(events, pairs, unpredicted), retrievalEffort(pairs, sensor, device), revisionQuality(events, truth), causalCoherence(events, truth), metacognition(events), transfer(truth)];
  const given = truth?.sound?.explanations.given ?? [];
  const stats = deviceStats(events, pairs, sensor, device);
  if (given.length) {
    const median = (xs: number[]) => (xs.length ? [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)] : 0);
    stats.items.push(
      { label: 'Explained aloud', value: `${given.filter((g) => g.inputMode === 'voice').length} of ${given.length}`, hint: 'Explanations spoken rather than typed' },
      { label: 'Pasted into the box', value: String(pastedCount(given)), hint: 'Explanations with 40 or more pasted characters' },
      { label: 'Time away from the tab', value: `${given.reduce((a, g) => a + g.blurs, 0)}×`, hint: 'Times the student left this tab while a task was open' },
      { label: 'Time with the result', value: `${r2(median(given.map((g) => g.dwellMs)) / 1000)}s`, hint: 'Median time between seeing a result and explaining it' },
    );
  }
  const calcs = (truth?.sound?.tasks ?? []).filter((t) => t.hasCalc);
  return {
    rubricVersion: `${RUBRIC_VERSION}-sound`,
    lessonType: 'physics_waves_sound',
    device,
    complete: truth?.sound?.submitted === true,
    dimensions: dims,
    overall: overall(dims, truth?.sound?.submitted === true, ALL_DIMENSIONS),
    deviceStats: stats,
    metrics: {
      predictionsMade: events.filter((e) => e.verb === 'predicted').length,
      actionsMade: events.filter((e) => e.verb === 'acted').length,
      anomalyNoticed: events.some((e) => e.verb === 'noticed_anomaly'),
      calcAttempts: calcs.reduce((a, t) => a + t.calcAttempts, 0),
      explanations: given.length,
      pastedExplanations: pastedCount(given),
      spokenExplanations: given.filter((g) => g.inputMode === 'voice').length,
      hasSensorData: sensor !== null,
    },
  };
}
