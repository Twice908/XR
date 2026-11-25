import { describe, expect, it } from 'vitest';
import { analyze, mergeSensorData, parseSensorCsv, type EventRow, type TruthInfo } from '..';
import { band, overall } from '../rules';
import type { DimensionResult } from '../types';

describe('shared scoring rules', () => {
  it('maps a ratio to 0-3 with one set of steps', () => {
    expect([0, 0.34, 0.35, 0.5, 0.64, 0.65, 0.89, 0.9, 1].map(band)).toEqual([0, 0, 1, 1, 1, 2, 2, 3, 3]);
  });

  it('scores an unfinished session against every dimension the lab assesses', () => {
    const dims = [
      { key: 'causalCoherence', score: 3 },
      { key: 'transfer', score: null },
    ] as unknown as DimensionResult[];
    expect(overall(dims, false, ['causalCoherence', 'transfer'])).toEqual({ points: 3, max: 6, percent: 50 });
    expect(overall(dims, true, ['causalCoherence', 'transfer'])).toEqual({ points: 3, max: 3, percent: 100 });
  });
});

let id = 0;
const ev = (verb: string, action: string, timestamp: number, data: Record<string, unknown>): EventRow => ({ id: ++id, verb, timestamp, device: 'web', object_data: { action, data } });

describe('retrieval effort', () => {
  it('ignores "what if?" answers, which lock and act in one click', () => {
    id = 0;
    const events: EventRow[] = [
      ev('investigated', 'enter_lab', 0, {}),
      // Two run trials, 5 s between locking and running.
      ev('predicted', 'predict_trial', 1000, { sample: 1, tool: 'run', confidence: 2, decisionMs: 3000 }),
      ev('acted', 'run_trial', 6000, { sample: 1, tool: 'run' }),
      ev('predicted', 'predict_trial', 7000, { sample: 2, tool: 'run', confidence: 2, decisionMs: 3000 }),
      ev('acted', 'run_trial', 12000, { sample: 2, tool: 'run' }),
      // A what-if answer: predicted and acted at the same instant.
      ev('predicted', 'predict_transfer', 13000, { sample: 3, tool: 'answer', confidence: 2, decisionMs: 3000 }),
      ev('acted', 'answer_transfer', 13000, { sample: 3, tool: 'answer' }),
    ];
    events[0].object_data!.target = 'physics-motion';
    const truth: TruthInfo = { tubes: [], submission: null, motion: { trials: [], total: 3 } };
    const r = analyze(events, null, truth);
    const retrieval = r.dimensions.find((d) => d.key === 'retrievalEffort')!;
    expect(retrieval.measures.avgPredictToActMs).toBe(5000);
    expect(retrieval.score).toBe(3);
  });
});

describe('sensor chunks', () => {
  it('joins the CSV chunks of one session in time order', () => {
    const head = 'timestamp,head_x,head_y,head_z,hand_x,hand_y,hand_z';
    const a = parseSensorCsv(`${head}\n3,0,0,0,0,0,0\n4,0,0,0,0,0,0`)!;
    const b = parseSensorCsv(`${head}\n1,0,0,0,0,0,0\n2,0,0,0,0,0,0`)!;
    const merged = mergeSensorData([a, b])!;
    expect(merged.format).toBe('web');
    expect(merged.samples.map((s) => s.t)).toEqual([1, 2, 3, 4]);
    expect(mergeSensorData([])).toBeNull();
  });
});
