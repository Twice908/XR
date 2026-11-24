import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { allTrials, redactMotion, resolveTrial, scorePrediction } from '../motion';

/** The simple-machines lab rides the same question engine as the motion, magnetism and circuits labs. */
const lesson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/simple-machines.json'), 'utf8'));
const trial = (id: string, i: number) => resolveTrial(allTrials(lesson).find((t) => t.id === id)!, i);
const p = (id: string, i: number) => trial(id, i).params as Record<string, number | string>;
const lever = (W: number, load: number, effort: number) => (W * load) / effort;

describe('simple-machines data', () => {
  it('has four tabs, every question with five sets of values, and answers that fit their inputs', () => {
    expect(lesson.type).toBe('physics_simple_machines');
    expect(lesson.scenarios.map((s: any) => s.id)).toEqual(['levers', 'pulleys', 'wheel_axle', 'inclined_plane']);
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
  it('the four surprises are marked, one per tab', () => {
    expect(allTrials(lesson).filter((t) => t.anomaly).map((t) => t.id)).toEqual(['lev_3', 'pul_3', 'pul_5', 'whl_3', 'inc_3']);
  });
  it('uses the supplied models, and the crate from the motion lab', () => {
    expect(Object.keys(lesson.assets).sort()).toEqual(['crate', 'cycleWheel', 'crowbar', 'pulley', 'ramp', 'tweezers', 'wheel', 'wheelbarrow'].sort());
    for (const url of Object.values(lesson.assets) as string[]) expect(url).toMatch(/^http:\/\/localhost:3007\/assets\/models\/[\w.-]+\.glb$/);
  });
});

describe('answers agree with the physics', () => {
  it('lever effort is W × load arm ÷ effort arm, and moving the fulcrum towards the load lowers it', () => {
    for (let i = 0; i < 5; i++) {
      const q = p('lev_1', i);
      const e = (d: number) => lever(Number(q.W), d, Number(q.L) - d);
      expect(trial('lev_1', i).answer.choice).toBe(Number(q.d2) < Number(q.d1) ? 'less' : 'more');
      expect(e(Number(q.d2)) < e(Number(q.d1))).toBe(Number(q.d2) < Number(q.d1));
      const r = p('lev_2', i);
      expect(trial('lev_2', i).answer.effort).toBeCloseTo(lever(Number(r.W), Number(r.d1), Number(r.L) - Number(r.d1)), 1);
    }
  });
  it('lev_3 names the lever that really needs less effort, and tweezers are class 3 (never class 1)', () => {
    for (let i = 0; i < 5; i++) {
      const q = p('lev_3', i);
      const a = lever(Number(q.W), Number(q.aLoad), Number(q.aEffort));
      const b = lever(Number(q.W), Number(q.bLoad), Number(q.bEffort));
      expect(trial('lev_3', i).answer.choice).toBe(a < b ? 'a' : 'b');
      for (const k of ['a', 'b']) if (String(q[`${k}Name`]).includes('tweezers')) expect(q[`${k}Cls`]).toBe(3);
    }
  });
  it('the single fixed pulley: effort = load, rope pulled = height; it saves no force', () => {
    for (let i = 0; i < 5; i++) {
      const q = p('pul_2', i);
      const a = trial('pul_2', i).answer;
      if ('effort' in a) expect(a.effort).toBeCloseTo(Number(q.W), 3);
      else expect(a.rope).toBeCloseTo(Number(q.h), 3);
      expect(trial('pul_3', i).answer.choice).toBe('same');
      expect(trial('pul_3', i).params).toMatchObject({ compare: true });
    }
  });
  it('the movable pulley and block-and-tackle questions are asked without a simulation, since the bench has one fixed pulley', () => {
    for (const id of ['pul_4', 'pul_5']) expect(allTrials(lesson).find((t) => t.id === id)!.action).toBeNull();
  });
  it('lev_5 and whl_4 agree with the lever law and the wheel-and-axle trade-off', () => {
    for (let i = 0; i < 5; i++) {
      const q = p('lev_5', i);
      expect(trial('lev_5', i).answer.effort).toBeCloseTo(lever(Number(q.W), Number(q.la), Number(q.ea)), 1);
      const cls = Number(q.focus);
      if (cls === 3) expect(Number(q.ea)).toBeLessThan(Number(q.la));
      if (cls === 2) expect(Number(q.ea)).toBeGreaterThan(Number(q.la));
      const w = p('whl_4', i);
      expect(trial('whl_4', i).answer.rope).toBeCloseTo((Number(w.h) * Number(w.R)) / Number(w.r), 1);
    }
  });
  it('wheel and axle effort is W × axle radius ÷ wheel radius; the thicker handle is easier', () => {
    for (let i = 0; i < 5; i++) {
      const q = p('whl_2', i);
      expect(trial('whl_2', i).answer.effort).toBeCloseTo((Number(q.W) * Number(q.r)) / Number(q.R), 1);
      const s = p('whl_3', i);
      expect(trial('whl_3', i).answer.choice).toBe(Number(s.R2) > Number(s.R1) ? 'thick' : 'thin');
    }
  });
  it('ramp effort is W × height ÷ length, and a longer ramp needs less', () => {
    for (let i = 0; i < 5; i++) {
      const q = p('inc_2', i);
      expect(trial('inc_2', i).answer.effort).toBeCloseTo((Number(q.W) * Number(q.h)) / Number(q.len1), 1);
      const r = p('inc_3', i);
      expect(Number(r.len2)).toBeGreaterThan(Number(r.len1));
      expect(trial('inc_3', i).answer.choice).toBe('less');
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
