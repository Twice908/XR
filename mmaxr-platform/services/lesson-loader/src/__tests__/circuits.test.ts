import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { allTrials, redactMotion, resolveTrial, scorePrediction } from '../motion';

/** The circuits lab rides the same question engine as the motion and magnetism labs. */
const lesson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/physics-electricity.json'), 'utf8'));
const trial = (id: string, i: number) => resolveTrial(allTrials(lesson).find((t) => t.id === id)!, i);
const p = (id: string, i: number) => trial(id, i).params as Record<string, number | string | boolean>;

describe('physics-electricity data', () => {
  it('has three tabs, every question with five sets of values, and answers that fit their inputs', () => {
    expect(lesson.type).toBe('physics_circuits');
    expect(lesson.scenarios.map((s: any) => s.id)).toEqual(['ohms_law', 'series_parallel', 'heating_fuse']);
    for (const t of allTrials(lesson)) {
      expect(t.variants, t.id).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        const r = resolveTrial(t, i);
        if (r.input.type === 'choice') expect(r.input.options.map((o) => o.id), `${t.id}/${i}`).toContain(r.answer.choice);
        else for (const f of r.input.fields) expect(typeof r.answer[f.id]).toBe('number');
        if (t.anomaly) expect((r.expectedKeywords ?? []).length).toBeGreaterThanOrEqual(3);
        const right = r.input.type === 'choice' ? { choice: r.answer.choice } : Object.fromEntries(r.input.fields.map((f) => [f.id, r.answer[f.id]]));
        expect(scorePrediction(r, right as never).match).toBe(true);
      }
      expect(new Set(t.variants!.map((v) => v.prompt)).size, t.id).toBeGreaterThanOrEqual(4);
    }
  });
  it('the two surprises are marked: more resistance gives less current, and a series bulb out puts both out', () => {
    expect(allTrials(lesson).filter((t) => t.anomaly).map((t) => t.id)).toEqual(['ohm_3', 'sp_2', 'fuse_3']);
  });
  it('uses the breadboard and the multimeter from the shared model folder', () => {
    expect(Object.keys(lesson.assets).sort()).toEqual(['breadboard', 'multimeter']);
    for (const url of Object.values(lesson.assets) as string[]) expect(url).toMatch(/^http:\/\/localhost:3007\/assets\/models\/[\w.-]+\.glb$/);
  });
});

describe('answers agree with the physics', () => {
  it('ohm_2 and ohm_4 are V / I and V / R', () => {
    for (let i = 0; i < 5; i++) {
      expect(trial('ohm_2', i).answer.current).toBeCloseTo(Number(p('ohm_2', i).v2) / Number(p('ohm_2', i).R), 2);
      const r = trial('ohm_4', i);
      if (r.input.type === 'numeric') expect(r.answer.resistance).toBeCloseTo(Number(p('ohm_4', i).R), 2);
    }
  });
  it('ohm_3: the current moves opposite to the resistance', () => {
    for (let i = 0; i < 5; i++) {
      const q = p('ohm_3', i);
      const factor = Number(q.r2) / Number(q.r1);
      const want = factor > 1 ? ['half', 'third', 'quarter'] : ['double'];
      expect(want).toContain(trial('ohm_3', i).answer.choice);
    }
  });
  it('series bulbs go out together, parallel bulbs do not', () => {
    for (let i = 0; i < 5; i++) {
      const r = trial('sp_2', i);
      const mode = p('sp_2', i).mode;
      if (mode === 'series') expect(r.answer.choice).toBe('out');
      else expect(['same', 'half']).toContain(r.answer.choice);
    }
  });
  it('sp_3 reads the battery current: V / 2R in series, 2V / R in parallel', () => {
    for (let i = 0; i < 5; i++) {
      const q = p('sp_3', i);
      const want = q.mode === 'series' ? Number(q.V) / (2 * Number(q.R)) : (2 * Number(q.V)) / Number(q.R);
      expect(trial('sp_3', i).answer.current).toBeCloseTo(want, 2);
    }
  });
  it('fuse_2 is the voltage at which the current reaches the rating: I (R_load + R_fuse)', () => {
    for (let i = 0; i < 5; i++) {
      const q = p('fuse_2', i);
      expect(trial('fuse_2', i).answer.volts).toBeCloseTo(Number(q.irated) * (Number(q.rload) + Number(q.rfuse)), 2);
    }
  });
});

describe('the browser sees none of it', () => {
  it('no answers, outcomes, explanations or law names', () => {
    const pub = JSON.stringify(redactMotion(lesson));
    for (const t of allTrials(lesson)) for (const v of t.variants!) {
      if ((v.outcome as string).length > 14) expect(pub).not.toContain(v.outcome as string);
      expect(pub).not.toContain(v.explanation as string);
    }
    for (const key of ['"answer"', 'expectedKeywords', 'coachSecrets', '"law"', '"laws"']) expect(pub).not.toContain(key);
  });
});
