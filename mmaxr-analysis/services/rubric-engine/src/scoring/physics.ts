import { travel } from './sensors';
import { LABELS, RUBRIC_VERSION, type Device, type DimensionResult, type EventRow, type Report, type SensorData } from './types';

/** Scoring for the original Bohr-model physics lab, kept as it was but expressed in the shared report shape. */
export function scorePhysics(events: EventRow[], sensor: SensorData | null, device: Device): Report {
  const predictions = events.filter((e) => e.verb === 'predicted');
  const actions = events.filter((e) => e.verb === 'acted');
  const anomalies = events.filter((e) => e.verb === 'noticed_anomaly');

  let total = 0;
  let count = 0;
  let totalMove = 0;
  for (let i = 0; i + 1 < events.length; i++) {
    if (events[i].verb === 'predicted' && events[i + 1].verb === 'acted') {
      total += events[i + 1].timestamp - events[i].timestamp;
      count++;
      totalMove += travel(sensor, 'hand', events[i].timestamp, events[i + 1].timestamp);
    }
  }
  const avgThink = count ? total / count : 0;
  const avgMove = count ? totalMove / count : 0;

  const dim = (key: DimensionResult['key'], score: number | null, basis: string, evidence: number[] = []): DimensionResult => ({ key, label: LABELS[key], score, max: 3, basis, evidence: evidence.slice(0, 8), measures: {} });
  const retrieval = avgThink > 2000 || avgMove > 0.5 ? 3 : avgThink > 500 || avgMove > 0.1 ? 2 : 1;
  const dims = [
    dim('predictionDiscipline', actions.length ? Math.min(3, Math.ceil((predictions.length / actions.length) * 3)) : 0, `${predictions.length} predictions for ${actions.length} actions.`, predictions.map((e) => e.id)),
    dim('retrievalEffort', count ? retrieval : null, `Average ${(avgThink / 1000).toFixed(1)}s between predicting and acting.`),
    dim('revisionQuality', anomalies.length ? 3 : 0, anomalies.length ? 'Noticed the injected anomaly.' : 'Did not flag the anomaly.', anomalies.map((e) => e.id)),
    dim('causalCoherence', null, 'Not scored for the physics lab.'),
    dim('metacognitiveCalibration', null, 'Not scored for the physics lab.'),
    dim('transfer', null, 'Not scored for the physics lab.'),
  ];
  const assessed = dims.filter((x) => x.score !== null);
  const points = assessed.reduce((s, x) => s + (x.score as number), 0);
  const max = assessed.length * 3;
  return {
    rubricVersion: `${RUBRIC_VERSION}-physics`,
    lessonType: 'physics_bohr',
    device,
    complete: anomalies.length > 0,
    dimensions: dims,
    overall: { points, max, percent: max ? Math.round((points / max) * 100) : null },
    deviceStats: {
      kind: device,
      items: [
        { label: 'Time to act', value: `${(avgThink / 1000).toFixed(1)}s`, hint: 'Prediction to action, average' },
        { label: 'Hand travel while deciding', value: `${avgMove.toFixed(2)} m`, hint: 'Between predicting and acting' },
      ],
    },
    metrics: { predictionsMade: predictions.length, actionsMade: actions.length, anomaliesNoticed: anomalies.length, hasSensorData: sensor !== null },
  };
}
