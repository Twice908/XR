import { describe, expect, it } from 'vitest';
import { analyze, parseSensorCsv, type EventRow } from '..';

let id = 0;
let t = 1_000_000;
const ev = (verb: string, action: string, extra: Partial<EventRow['object_data']> = {}, dt = 500, device: string | null = 'web'): EventRow => ({
  id: ++id,
  verb,
  timestamp: (t += dt),
  device,
  object_data: { action, ...extra },
});

/** A student who predicts, waits to think, acts, records, and concludes. */
function run(opts: { decisionMs: number; gapMs: number; right: boolean[]; conf: number[]; conclusions: ('acid' | 'base' | 'neutral')[]; truth: ('acid' | 'base' | 'neutral')[]; device?: string | null }): EventRow[] {
  id = 0;
  t = 1_000_000;
  const dev = 'device' in opts ? (opts.device as string | null) : 'web';
  const out: EventRow[] = [ev('investigated', 'enter_lab', { target: 'chemistry-101' }, 500, dev)];
  opts.right.forEach((right, i) => {
    const data = { tube: i + 1, tool: 'litmus' };
    out.push(ev('predicted', 'predict_color', { target: `tube:${i + 1}`, value: right ? ['Red', 'Blue', 'Purple'][i % 3] : 'Green', data: { ...data, decisionMs: opts.decisionMs, confidence: opts.conf[i] } }, 300, dev));
    out.push(ev('acted', 'add_indicator', { target: `tube:${i + 1}`, value: 'litmus', data }, opts.gapMs, dev));
    out.push(ev('observed', 'liquid_color', { target: `tube:${i + 1}`, value: 'Red', data: { ...data, match: right } }, 10, dev));
  });
  opts.conclusions.forEach((c, i) => {
    out.push(ev('explained', 'set_conclusion', { target: `tube:${i + 1}`, value: c, data: { tube: i + 1, correct: c === opts.truth[i] } }, 300, dev));
  });
  out.push(
    ev('explained', 'submit_analysis', { data: { tubes: opts.conclusions.map((c, i) => ({ tube: i + 1, conclusion: c, truth: opts.truth[i], recordedPh: opts.truth[i] === 'acid' ? 2 : opts.truth[i] === 'base' ? 12 : 7, actualPh: opts.truth[i] === 'acid' ? 2 : opts.truth[i] === 'base' ? 12 : 7 })) } }, 300, dev),
  );
  return out;
}

const score = (r: ReturnType<typeof analyze>, key: string) => r.dimensions.find((d) => d.key === key)!.score;

describe('chemistry rubric', () => {
  const truth = ['acid', 'base', 'neutral', 'acid', 'base'] as const;

  it('gives a thoughtful, accurate, well-calibrated student the top marks', () => {
    const r = analyze(run({ decisionMs: 4000, gapMs: 3500, right: [true, true, true, true, true], conf: [3, 3, 3, 3, 3], conclusions: [...truth], truth: [...truth] }), null, );
    expect(score(r, 'predictionDiscipline')).toBe(3);
    expect(score(r, 'retrievalEffort')).toBe(2);
    expect(score(r, 'revisionQuality')).toBe(3);
    expect(score(r, 'causalCoherence')).toBe(3);
    expect(score(r, 'metacognitiveCalibration')).toBe(3);
    expect(score(r, 'transfer')).toBeNull();
    expect(r.complete).toBe(true);
    expect(r.overall.percent).toBeGreaterThan(80);
  });

  it('marks down fast, wrong, same-colour guessing', () => {
    const events = run({ decisionMs: 400, gapMs: 200, right: [false, false, false, false, false], conf: [3, 3, 3, 3, 3], conclusions: ['acid', 'acid', 'acid', 'acid', 'acid'], truth: [...truth] });
    events.filter((e) => e.verb === 'predicted').forEach((e) => (e.object_data!.value = 'Red'));
    const r = analyze(events, null);
    expect(score(r, 'predictionDiscipline')).toBeLessThanOrEqual(1);
    expect(score(r, 'metacognitiveCalibration')).toBe(0);
    expect(score(r, 'causalCoherence')!).toBeLessThanOrEqual(1);
    expect(r.overall.percent!).toBeLessThan(40);
  });

  it('scores 0 for prediction discipline when the student acts without predicting', () => {
    const events = run({ decisionMs: 3000, gapMs: 2000, right: [true, true, true], conf: [2, 2, 2], conclusions: ['acid', 'base', 'neutral'], truth: ['acid', 'base', 'neutral'] }).filter((e) => e.verb !== 'predicted');
    expect(score(analyze(events, null), 'predictionDiscipline')).toBe(0);
  });

  it('rewards fixing a wrong first conclusion and penalises breaking a right one', () => {
    const base = run({ decisionMs: 3000, gapMs: 2000, right: [true, true, true], conf: [2, 2, 2], conclusions: ['neutral', 'base', 'neutral'], truth: ['acid', 'base', 'neutral'] });
    const fixed = [
      ...base,
      { id: 900, verb: 'revised_model', timestamp: 9_999_999, device: 'web', object_data: { action: 'change_conclusion', data: { tube: 1, from: 'neutral', to: 'acid', wasCorrect: false, nowCorrect: true } } } as EventRow,
    ];
    expect(score(analyze(base, null), 'revisionQuality')).toBe(0);
    expect(score(analyze(fixed, null), 'revisionQuality')).toBe(3);
    const broke = [
      ...base,
      { id: 901, verb: 'revised_model', timestamp: 9_999_999, device: 'web', object_data: { action: 'change_conclusion', data: { tube: 2, from: 'base', to: 'acid', wasCorrect: true, nowCorrect: false } } } as EventRow,
    ];
    expect(score(analyze(broke, null), 'revisionQuality')!).toBeLessThan(3);
  });

  it('reports not-assessed instead of guessing when the session is unfinished', () => {
    const events = run({ decisionMs: 3000, gapMs: 2000, right: [true], conf: [2], conclusions: [], truth: [] }).filter((e) => action(e) !== 'submit_analysis');
    const r = analyze(events, null);
    expect(r.complete).toBe(false);
    expect(score(r, 'causalCoherence')).toBeNull();
    expect(score(r, 'revisionQuality')).toBeNull();
    expect(score(r, 'metacognitiveCalibration')).toBeNull();
  });

  it('is deterministic', () => {
    const events = run({ decisionMs: 2500, gapMs: 1500, right: [true, false, true], conf: [2, 1, 3], conclusions: ['acid', 'base', 'neutral'], truth: ['acid', 'base', 'neutral'] });
    expect(JSON.stringify(analyze(events, null))).toBe(JSON.stringify(analyze([...events].reverse(), null)));
  });
});

const action = (e: EventRow) => e.object_data?.action;

describe('device awareness', () => {
  const web = 'timestamp,head_x,head_y,head_z,hand_x,hand_y,hand_z\n';
  const csvRows = (n: number, step: number) => Array.from({ length: n }, (_, i) => `${1_000_000 + i * 33},0,1.5,1.5,${i * step},0.9,0`).join('\n');

  const events = (device: string | null) => run({ decisionMs: 3000, gapMs: 2000, right: [true, true, true], conf: [2, 2, 2], conclusions: ['acid', 'base', 'neutral'], truth: ['acid', 'base', 'neutral'], device });

  it('tags the session from the events, falling back to the sensor file format', () => {
    expect(analyze(events('web'), null).device).toBe('web');
    expect(analyze(events('vr'), null).device).toBe('vr');
    expect(analyze(events(null), null).device).toBe('unknown');
    const unity = 'timestamp,headX,headY,headZ,headRX,headRY,headRZ,headRW,leftX,leftY,leftZ,leftRX,leftRY,leftRZ,leftRW,rightX,rightY,rightZ,rightRX,rightRY,rightRZ,rightRW\n1000000,0,1.6,0,0,0,0,1,0,1,0,0,0,0,1,0.1,1,0.2,0,0,0,1';
    expect(analyze(events(null), parseSensorCsv(unity)).device).toBe('vr');
  });

  it('parses both sensor CSV formats by header', () => {
    expect(parseSensorCsv(web + csvRows(5, 0.01))?.format).toBe('web');
    expect(parseSensorCsv('a,b\n1,2')).toBeNull();
  });

  it('judges movement against a device-appropriate bar', () => {
    const sensor = parseSensorCsv(web + csvRows(400, 0.004)); // ~0.2 m of travel per 2s gap
    const asWeb = analyze(events('web'), sensor);
    const asVr = analyze(events('vr'), sensor);
    // Same movement clears the web bar (0.3 m) more easily than the VR bar (0.8 m).
    expect(asWeb.dimensions.find((d) => d.key === 'retrievalEffort')!.score!).toBeGreaterThanOrEqual(asVr.dimensions.find((d) => d.key === 'retrievalEffort')!.score!);
    expect(asVr.deviceStats.kind).toBe('vr');
    expect(asVr.deviceStats.items.some((i) => i.label.startsWith('Hand travel'))).toBe(true);
    expect(asWeb.deviceStats.items.some((i) => i.label.startsWith('Pointer travel'))).toBe(true);
  });
});

describe('scoring against server-held truth (browser sends no correctness)', () => {
  const truthTubes = [
    { tube: 1, type: 'acid', ph: 2 },
    { tube: 2, type: 'base', ph: 12 },
    { tube: 3, type: 'neutral', ph: 7 },
  ];
  const base = () => {
    id = 0;
    t = 1_000_000;
    const e: EventRow[] = [ev('investigated', 'enter_lab', { target: 'chemistry-101' })];
    [1, 2, 3].forEach((n) => {
      const data = { tube: n, tool: 'litmus' };
      e.push(ev('predicted', 'predict_color', { target: `tube:${n}`, value: ['Red', 'Blue', 'Purple'][n - 1], data: { ...data, decisionMs: 3000, confidence: 2 } }, 300));
      e.push(ev('acted', 'add_indicator', { target: `tube:${n}`, value: 'litmus', data }, 2000));
      e.push(ev('observed', 'liquid_color', { target: `tube:${n}`, value: ['Red', 'Blue', 'Purple'][n - 1], data: { ...data, match: true } }, 10));
    });
    return e;
  };
  // Conclusion events carry no `correct` flag any more.
  const concl = (tube: number, value: string) => ev('explained', 'set_conclusion', { target: `tube:${tube}`, value, data: { tube: tube, evidence: ['litmus'] } }, 300);
  const revise = (tube: number, from: string, to: string) => ev('revised_model', 'change_conclusion', { target: `tube:${tube}`, value: to, data: { tube, from, to, evidenceCount: 2 } }, 300);
  const submitEv = () => ev('explained', 'submit_analysis', { data: { tubes: [] } }, 300);
  const submission = (c: (string | null)[], ph: (number | null)[]) => ({ tubes: c.map((x, i) => ({ tube: i + 1, conclusion: x, ph: ph[i] })) });

  it('judges first conclusions and revisions from the truth', () => {
    const events = [...base(), concl(1, 'neutral'), concl(2, 'base'), concl(3, 'neutral'), revise(1, 'neutral', 'acid')];
    const r = analyze(events, null, { tubes: truthTubes, submission: null });
    expect(score(r, 'revisionQuality')).toBe(3);
    const noFix = analyze([...base(), concl(1, 'neutral'), concl(2, 'base'), concl(3, 'neutral')], null, { tubes: truthTubes, submission: null });
    expect(score(noFix, 'revisionQuality')).toBe(0);
    const broke = analyze([...base(), concl(1, 'acid'), concl(2, 'base'), concl(3, 'neutral'), revise(2, 'base', 'acid')], null, { tubes: truthTubes, submission: null });
    expect(score(broke, 'revisionQuality')!).toBeLessThan(3);
  });

  it('scores causal coherence from the submission the server locked, not from browser events', () => {
    const events = [...base(), concl(1, 'acid'), concl(2, 'base'), concl(3, 'neutral'), submitEv()];
    const good = analyze(events, null, { tubes: truthTubes, submission: submission(['acid', 'base', 'neutral'], [2, 12, 7]) });
    expect(good.complete).toBe(true);
    expect(score(good, 'causalCoherence')).toBe(3);
    const bad = analyze(events, null, { tubes: truthTubes, submission: submission(['base', 'acid', 'acid'], [13, 3, 1]) });
    expect(score(bad, 'causalCoherence')).toBe(0);
  });

  it('does not believe a browser-claimed submission the server never saw', () => {
    const events = [...base(), concl(1, 'acid'), concl(2, 'base'), concl(3, 'neutral'), submitEv()];
    const r = analyze(events, null, { tubes: truthTubes, submission: null });
    expect(r.complete).toBe(false);
    expect(score(r, 'causalCoherence')).toBeNull();
  });

  it('reports not-assessed rather than guessing when no truth is available for new-format events', () => {
    const events = [...base(), concl(1, 'acid'), concl(2, 'base'), concl(3, 'neutral')];
    const r = analyze(events, null, null);
    expect(score(r, 'revisionQuality')).toBeNull();
    expect(score(r, 'causalCoherence')).toBeNull();
  });
});

describe('metals lab scoring', () => {
  const truthTubes = [
    { tube: 1, type: 'metal', ph: 0 },
    { tube: 2, type: 'non-metal', ph: 0 }, // graphite-like: conducts but is a non-metal
    { tube: 3, type: 'non-metal', ph: 0 },
  ];
  const mk = (opts: { predictedRight?: boolean; decisionMs?: number } = {}) => {
    id = 0;
    t = 1_000_000;
    const out: EventRow[] = [ev('investigated', 'enter_lab', { target: 'metals-101' })];
    const run = (sample: number, tool: string, predicted: string, actual: string) => {
      const data = { sample, tool };
      out.push(ev('predicted', 'predict_outcome', { target: `sample:${sample}`, value: predicted, data: { ...data, decisionMs: opts.decisionMs ?? 3500, confidence: 2 } }, 300));
      out.push(ev('acted', 'run_test', { target: `sample:${sample}`, value: tool, data }, 2200));
      out.push(ev('observed', 'test_result', { target: `sample:${sample}`, value: actual, data: { ...data, predicted, match: predicted === actual } }, 10));
    };
    run(1, 'hammer', 'flattens', 'flattens');
    run(1, 'circuit', 'glows', 'glows');
    run(2, 'hammer', 'flattens', 'shatters');
    run(2, 'circuit', 'dark', 'glows'); // the anomaly
    run(3, 'hammer', 'shatters', 'shatters');
    run(3, 'wire', 'snaps', 'snaps');
    return out;
  };
  const concl = (sample: number, value: string) => ev('explained', 'set_conclusion', { target: `sample:${sample}`, value, data: { sample, stage: 'hypothesis' } }, 200);
  const revise = (sample: number, from: string, to: string) => ev('revised_model', 'change_conclusion', { target: `sample:${sample}`, value: to, data: { sample, from, to } }, 200);
  const sub = (c: string[]) => ({ tubes: c.map((x, i) => ({ tube: i + 1, conclusion: x, ph: null })) });
  const truth = (c: string[] | null) => ({ tubes: truthTubes, submission: c ? sub(c) : null });

  it('is detected as the metals lab and uses the shared dimensions', () => {
    const r = analyze(mk(), null, truth(null));
    expect(r.lessonType).toBe('chemistry_metals');
    expect(score(r, 'predictionDiscipline')).toBeGreaterThanOrEqual(2);
    expect(r.dimensions.find((x) => x.key === 'transfer')!.score).toBeNull();
  });

  it('rewards catching the exception: wrong first impression revised after contradicting evidence', () => {
    const events = [...mk(), concl(1, 'metal'), concl(2, 'metal'), concl(3, 'non-metal'), revise(2, 'metal', 'non-metal')];
    const r = analyze(events, null, truth(['metal', 'non-metal', 'non-metal']));
    expect(score(r, 'revisionQuality')).toBe(3);
    expect(score(r, 'causalCoherence')).toBe(3);
    expect(r.complete).toBe(true);
    expect(r.overall.percent!).toBeGreaterThan(70);
  });

  it('marks down a student who trusted the surface (kept the wrong impression) and the evidence disagreed', () => {
    const events = [...mk(), concl(1, 'metal'), concl(2, 'metal'), concl(3, 'metal')];
    const r = analyze(events, null, truth(['metal', 'metal', 'metal']));
    expect(score(r, 'revisionQuality')).toBe(0);
    expect(score(r, 'causalCoherence')!).toBeLessThanOrEqual(1);
  });

  it('does not count conclusions with fewer than two tests as supported', () => {
    const thin = mk().slice(0, 7); // sample 1 tested twice, sample 2 once
    const r = analyze([...thin, concl(1, 'metal'), concl(2, 'non-metal'), concl(3, 'non-metal')], null, truth(['metal', 'non-metal', 'non-metal']));
    const cc = r.dimensions.find((x) => x.key === 'causalCoherence')!;
    expect(cc.measures.supported).toBeLessThan(3);
  });

  it('is not assessed until the server has the submission', () => {
    const r = analyze([...mk(), concl(1, 'metal')], null, truth(null));
    expect(score(r, 'causalCoherence')).toBeNull();
    expect(r.complete).toBe(false);
  });
});

describe('digestive-system journey scoring', () => {
  const stop = (n: number, opts: { all?: boolean; cov?: number; covFinal?: number; revisions?: number; voice?: boolean } = {}) => ({
    id: `s${n}`, n, selection: { glands: opts.all === false ? 0.5 : 1, juices: 1, nutrients: opts.all === false ? 0.5 : 1, allCorrect: opts.all !== false },
    coverageFirst: opts.cov ?? 1, coverageFinal: opts.covFinal ?? opts.cov ?? 1, revisions: opts.revisions ?? 0, inputMode: opts.voice === false ? 'typed' as const : 'voice' as const, speakMs: 20000, thinkMs: 9000,
  });
  const truth = (stops: ReturnType<typeof stop>[], fin: { correct: number; total: number } | null) => ({ tubes: [], submission: null, biology: { checkpoints: stops, final: fin } });
  const mk = (n: number, confidence: number, match: boolean) => {
    id = 0; t = 1_000_000;
    const out: EventRow[] = [ev('investigated', 'enter_lab', { target: 'biology-101' })];
    for (let i = 1; i <= n; i++) {
      const data = { sample: i, tool: 'explain' };
      out.push(ev('predicted', 'predict_selection', { target: `checkpoint:s${i}`, value: ['a', 'b', 'c', 'd', 'e'][i - 1] ?? 'x', data: { ...data, decisionMs: 9000, confidence } }, 9000));
      out.push(ev('acted', 'commit_explanation', { target: `checkpoint:s${i}`, value: 'explain', data }, 20000));
      out.push(ev('observed', 'reveal_shown', { target: `checkpoint:s${i}`, value: match ? 'correct' : 'partly', data: { ...data, match } }, 10));
    }
    return out;
  };

  it('is detected as the journey and scores a strong student highly', () => {
    const stops = [1, 2, 3, 4, 5].map((n) => stop(n));
    const r = analyze(mk(5, 3, true), null, truth(stops, { correct: 3, total: 3 }));
    expect(r.lessonType).toBe('biology_digestive_system');
    expect(score(r, 'causalCoherence')).toBe(3);
    expect(score(r, 'transfer')).toBe(3);
    expect(score(r, 'revisionQuality')).toBe(3); // nothing needed improving
    expect(score(r, 'metacognitiveCalibration')).toBe(3);
    expect(r.complete).toBe(true);
    expect(r.overall.percent!).toBeGreaterThan(75);
  });

  it('rewards improving a thin explanation after the reveal, and marks down not trying', () => {
    const thin = [1, 2, 3, 4, 5].map((n) => stop(n, { cov: 0.4 }));
    expect(score(analyze(mk(5, 2, false), null, truth(thin, null)), 'revisionQuality')).toBe(0);
    const improved = [1, 2, 3, 4, 5].map((n) => stop(n, { cov: 0.4, covFinal: 0.9, revisions: 1 }));
    expect(score(analyze(mk(5, 2, false), null, truth(improved, null)), 'revisionQuality')).toBe(3);
  });

  it('scores causal coherence from the first explanations and the predicted selections', () => {
    const weak = [1, 2, 3, 4, 5].map((n) => stop(n, { all: false, cov: 0.2 }));
    expect(score(analyze(mk(5, 3, false), null, truth(weak, null)), 'causalCoherence')!).toBeLessThanOrEqual(1);
  });

  it('transfer waits for the challenge and scales with correct answers', () => {
    const stops = [1, 2, 3].map((n) => stop(n));
    expect(score(analyze(mk(3, 2, true), null, truth(stops, null)), 'transfer')).toBeNull();
    expect(score(analyze(mk(3, 2, true), null, truth(stops, { correct: 1, total: 3 })), 'transfer')).toBe(1);
    expect(analyze(mk(3, 2, true), null, truth(stops, null)).complete).toBe(false);
  });

  it('flags overconfidence: certain but not matching', () => {
    const stops = [1, 2, 3, 4, 5].map((n) => stop(n, { all: false, cov: 0.3 }));
    expect(score(analyze(mk(5, 3, false), null, truth(stops, null)), 'metacognitiveCalibration')).toBe(0);
  });

  it('reports device-appropriate stats', () => {
    const stops = [1, 2].map((n) => stop(n));
    const vr = analyze(mk(2, 2, true).map((e) => ({ ...e, device: 'vr' })), null, truth(stops, null));
    expect(vr.deviceStats.items.some((i) => i.label === 'Eye gaze')).toBe(true);
    const web = analyze(mk(2, 2, true), null, truth(stops, null));
    expect(web.deviceStats.items.some((i) => i.label === 'Camera movement')).toBe(true);
  });
});
