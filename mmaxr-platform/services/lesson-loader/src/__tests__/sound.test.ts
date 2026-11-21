import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { SoundLessonContract } from '@mmaxr/schema';
import { allDone, buildReveal, checkCalc, checkExplanation, derive, drawn, flatTasks, hasCalc, judgeTrial, makePlan, owesExplanation, personalize, redactSound, revealFor, truthFor, type SoundAssignment } from '../sound';

const raw: SoundLessonContract = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/physics-sound.json'), 'utf8'));
const seeded = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};
const session = (seed: number) => {
  const plan = makePlan(raw, seeded(seed));
  const a: SoundAssignment = { kind: 'sound', lessonId: raw.lessonId, studentId: 's', plan, trials: {}, submission: null, createdAt: 0 };
  return { plan, a, p: personalize(raw, plan) };
};
const T0 = 1_000_000;
/** The act that satisfies each task, using this session's own numbers. */
const goodAct = (a: SoundAssignment, id: string) => {
  const par = personalize(raw, a.plan).scenarios.flatMap((s) => s.tasks).find((t) => t.id === id)!.params;
  return { wave_1: { freq: par.f2 }, wave_2: { amp: par.a2 }, echo_1: { clappedField: true, clappedRoom: true }, echo_2: { measuredT: par.t }, sonar_1: { pulse: true }, ultrasound_1: { scannedAudible: true, scannedUltra: true } }[id] as never;
};
const run = (a: SoundAssignment, id: string, right = true) => {
  const t = flatTasks(raw).find((x) => x.id === id)!;
  const pick = right ? t.answer! : t.predictionOptions.find((o) => o.id !== t.answer)!.id;
  const j = judgeTrial(raw, a.plan, id, pick, goodAct(a, id));
  if (!j || 'error' in j) throw new Error(JSON.stringify(j));
  a.trials[id] = { id, prediction: pick, confidence: 2, thinkMs: 1000, at: T0, resultAt: T0, match: j.match, act: j.act, calcAttempts: 0, calcValue: null, calcOk: false };
  return a.trials[id];
};
const anchorText = (a: SoundAssignment, id: string) => {
  const groups = personalize(raw, a.plan).scenarios.flatMap((s) => s.tasks).find((t) => t.id === id)!.anchors!;
  return `In my own run I saw ${groups.map((g) => g[0]).join(' and ')} on the bench and compared it with what I predicted`;
};
const explain = (a: SoundAssignment, id: string, text = anchorText(a, id), extra: Record<string, unknown> = {}, at = T0 + 20_000) => {
  const r = checkExplanation(raw, a, id, { text, inputMode: 'typed', speakMs: 0, thinkMs: 1, pasted: 0, blurs: 0, ...extra }, at);
  if ('explanation' in r) a.trials[id].explanation = r.explanation;
  return r;
};
const everything = (a: SoundAssignment) => {
  for (const t of flatTasks(raw)) {
    const tr = run(a, t.id);
    if (hasCalc(raw, a.plan, t.id)) {
      tr.calcAttempts = 1;
      tr.calcOk = true;
    }
    explain(a, t.id);
  }
};

describe('physics-sound data', () => {
  it('has three tabs, six tasks and one anomaly', () => {
    expect(raw.scenarios.map((s) => s.tool)).toEqual(['wave', 'echo', 'sonar']);
    expect(flatTasks(raw)).toHaveLength(6);
    expect(flatTasks(raw).filter((t) => t.isAnomaly).map((t) => t.id)).toEqual(['wave_1']);
  });
  it('every task has 8 variants to draw from and an answer among its options', () => {
    for (const t of flatTasks(raw)) {
      expect(t.variants, t.id).toHaveLength(8);
      expect(t.predictionOptions.map((o) => o.id)).toContain(t.answer);
    }
  });
});

describe('the physics is right for every variant', () => {
  it('wave speed stays constant: f1·λ1 = f2·λ2 = v, and a higher frequency gives a shorter wavelength', () => {
    for (const v of flatTasks(raw).find((t) => t.id === 'wave_1')!.variants!) {
      const d = derive('wave_1', v);
      expect(d.facts.product1).toBeCloseTo(Number(v.v), 2);
      expect(d.facts.product2).toBeCloseTo(Number(v.v), 2);
      expect(Number(d.facts.lambda2Cm)).toBeLessThan(Number(d.facts.lambda1Cm));
    }
  });
  it('doubling the amplitude adds about 6 dB', () => {
    expect(derive('wave_2', { a1: 2, a2: 4 }).facts.gainDb).toBeCloseTo(6, 0);
  });
  it('echo and sonar distances are (speed × time) / 2, and the wrong options are the usual slips', () => {
    for (const id of ['echo_2', 'sonar_1']) {
      for (const v of flatTasks(raw).find((t) => t.id === id)!.variants!) {
        const d = derive(id, v);
        const dist = Number(id === 'echo_2' ? d.facts.distanceM : d.facts.depthM);
        expect(dist).toBeCloseTo((Number(v.v) * Number(v.t)) / 2, 1);
        expect(Number(d.facts.totalPathM)).toBeCloseTo(dist * 2, 1);
      }
    }
  });
  it('the options for echo_2 and sonar_1 are the distance, double it and half of it', () => {
    const { p } = session(3);
    for (const id of ['echo_2', 'sonar_1']) {
      const t = flatTasks(p).find((x) => x.id === id)!;
      const nums = t.predictionOptions.map((o) => parseFloat(o.label)).sort((a, b) => a - b);
      const right = parseFloat(t.predictionOptions.find((o) => o.id === t.answer)!.label);
      expect(nums).toEqual([right / 2, right, right * 2]);
    }
  });
});

describe('a run of its own for every session', () => {
  it('draws different numbers, task orders and option orders', () => {
    const runs = Array.from({ length: 14 }, (_, i) => personalize(raw, makePlan(raw, seeded(i * 7919 + 13))));
    const f2 = new Set(runs.map((l) => flatTasks(l).find((t) => t.id === 'wave_1')!.params.f2));
    const order = new Set(runs.map((l) => l.scenarios[0].tasks.map((t) => t.id).join()));
    const opts = new Set(runs.map((l) => flatTasks(l)[0].predictionOptions.map((o) => o.id).join()));
    expect(f2.size).toBeGreaterThan(2);
    expect(order.size).toBe(2);
    expect(opts.size).toBeGreaterThan(3);
  });
  it('the answer lands in every position', () => {
    const seen = new Set<number>();
    for (let i = 1; i <= 40; i++) {
      const t = flatTasks(personalize(raw, makePlan(raw, seeded(i * 11)))).find((x) => x.id === 'wave_1')!;
      seen.add(t.predictionOptions.findIndex((o) => o.id === t.answer));
    }
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });
  it('fills this session\'s numbers into the prompt', () => {
    const { p } = session(5);
    const t = flatTasks(p).find((x) => x.id === 'echo_2')!;
    expect(t.prompt).toContain(`${Number(t.params.t).toFixed(1)} s`);
    expect(t.prompt).not.toMatch(/\{/);
  });
});

describe('redactSound', () => {
  it('leaks no answer, explanation, anomaly flag, anchor, variant or use', () => {
    const text = JSON.stringify(redactSound(session(5).p));
    for (const s of ['"answer"', 'expectedOutcome', '"explanation"', 'isAnomaly', 'anomalyExplanation', '"anchors"', '"variants"', '"uses"', 'distanceM', 'depthM']) expect(text, s).not.toContain(s);
  });
  it('does not put the distance to the cliff or the depth of the sea in the params', () => {
    const { a } = session(5);
    const p = personalize(raw, a.plan);
    for (const id of ['echo_2', 'sonar_1']) {
      const t = flatTasks(p).find((x) => x.id === id)!;
      const facts = drawn(raw, a.plan, id)!.d.facts;
      const secret = Number(facts.distanceM ?? facts.depthM);
      expect(Object.values(t.params).map(Number)).not.toContain(secret);
      expect(t.prompt).not.toContain(` ${secret} m`);
    }
  });
});

describe('running an experiment', () => {
  it('refuses to disclose anything until the experiment is actually done', () => {
    const { a } = session(2);
    const t = flatTasks(raw).find((x) => x.id === 'wave_1')!;
    expect(judgeTrial(raw, a.plan, 'wave_1', t.answer, { freq: 4 })).toMatchObject({ error: expect.stringMatching(/Set the generator/) });
    expect(judgeTrial(raw, a.plan, 'echo_1', 'a', { clappedField: true })).toMatchObject({ error: expect.stringMatching(/both/) });
    expect(judgeTrial(raw, a.plan, 'sonar_1', 'a', {})).toMatchObject({ error: expect.stringMatching(/pulse/) });
    expect(judgeTrial(raw, a.plan, 'ultrasound_1', 'a', { scannedUltra: true })).toMatchObject({ error: expect.stringMatching(/audible/) });
    expect(judgeTrial(raw, a.plan, 'echo_2', 'a', { measuredT: 9 })).toMatchObject({ error: expect.stringMatching(/stopwatch/) });
  });
  it('rejects unknown tasks and options', () => {
    const { a } = session(2);
    expect(judgeTrial(raw, a.plan, 'nope', 'a', {})).toBeNull();
    expect(judgeTrial(raw, a.plan, 'echo_1', 'zzz', {})).toBeNull();
  });
  it('grades the prediction and shows the readings, flagging the anomaly when it was missed', () => {
    const { a } = session(2);
    const bad = run(a, 'wave_1', false);
    expect(bad.match).toBe(false);
    const j = judgeTrial(raw, a.plan, 'wave_1', bad.prediction, bad.act) as { result: { anomaly?: boolean; data: Record<string, number> } };
    expect(j.result.anomaly).toBe(true);
    expect(j.result.data.lambda2Cm).toBeLessThan(j.result.data.lambda1Cm);
    expect(JSON.stringify(j.result)).not.toMatch(/explanation|answer/);
  });
});

describe('the calculation', () => {
  it('is checked against the student\'s own reading, within 4%, counting the tries', () => {
    const { a } = session(7);
    const tr = run(a, 'sonar_1');
    const truth = Number(drawn(raw, a.plan, 'sonar_1')!.d.facts.depthM);
    expect(checkCalc(raw, a.plan, tr, truth * 2)).toMatchObject({ ok: false, attempts: 1 });
    expect(checkCalc(raw, a.plan, tr, 'abc')).toHaveProperty('error');
    expect(checkCalc(raw, a.plan, tr, truth * 1.03)).toMatchObject({ ok: true, attempts: 2 });
    expect(tr.calcOk).toBe(true);
    expect(checkCalc(raw, a.plan, run(a, 'wave_2'), 5)).toHaveProperty('error');
  });
});

describe('explanations', () => {
  it('are refused when too short, too quick, off-topic, or before the calculation, without saying the answer', () => {
    const { a } = session(4);
    const tr = run(a, 'sonar_1');
    expect(explain(a, 'sonar_1')).toMatchObject({ error: expect.stringMatching(/calculation/) });
    tr.calcOk = true;
    expect(explain(a, 'sonar_1', 'too short')).toMatchObject({ error: expect.stringMatching(/at least/) });
    expect(explain(a, 'sonar_1', anchorText(a, 'sonar_1'), {}, T0 + 1000)).toMatchObject({ error: expect.stringMatching(/moment/) });
    const generic = explain(a, 'sonar_1', 'The pulse goes down and comes back so the depth is half of the distance travelled by it');
    expect(generic).toMatchObject({ error: expect.stringMatching(/number from your own run/) });
    expect(JSON.stringify(generic)).not.toContain(String(drawn(raw, a.plan, 'sonar_1')!.d.facts.depthM));
    expect(explain(a, 'sonar_1')).toHaveProperty('explanation');
  });
  it('a spoken one needs a real recording', () => {
    const { a } = session(4);
    run(a, 'wave_2');
    expect(explain(a, 'wave_2', undefined, { inputMode: 'voice', speakMs: 900 })).toMatchObject({ error: expect.stringMatching(/too short/) });
    expect(explain(a, 'wave_2', undefined, { inputMode: 'voice', speakMs: 9000, blurs: 1 })).toHaveProperty('explanation.inputMode', 'voice');
  });
  it('nothing more is run until the last run is explained, then the explanation is disclosed', () => {
    const { a } = session(4);
    run(a, 'wave_2');
    expect(owesExplanation(a)?.id).toBe('wave_2');
    explain(a, 'wave_2');
    expect(owesExplanation(a)).toBeNull();
    const rv = revealFor(raw, a.plan, 'wave_1');
    expect(rv.anomalyExplanation).toMatch(/inversely proportional/);
    expect(rv.explanation).toMatch(/wavelength decreases/);
  });
});

describe('finishing', () => {
  it('needs every task run, calculated and explained, then scores and reveals', () => {
    const { a } = session(8);
    run(a, 'wave_2');
    expect(allDone(raw, a)).toBe(false);
    const b = session(8).a;
    everything(b);
    expect(allDone(raw, b)).toBe(true);
    b.submission = { at: 1 };
    const rv = buildReveal(raw, b);
    expect(rv.correct).toBe(6);
    expect(rv.uses.map((u) => u.topic)).toContain('Sonar');
    const tf = truthFor(raw, b);
    expect(tf.tasks.find((t) => t.id === 'sonar_1')).toMatchObject({ hasCalc: true, calcOk: true, tool: 'sonar' });
    expect(tf.explanations.required).toBe(6);
  });
});
