import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { allTrials, redactMotion, resolveTrial, scorePrediction } from '../motion';

/** The fundamentals lab rides the shared question engine, with a concept card opening each idea. */
const lesson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/physics-fundamentals.json'), 'utf8'));
const trial = (id: string, i: number) => resolveTrial(allTrials(lesson).find((t) => t.id === id)!, i);
const g = 9.8;

describe('physics-fundamentals data', () => {
  it('has the four tabs of the contract, every question with five sets of values and answers that fit their inputs', () => {
    expect(lesson.type).toBe('physics_fundamentals_sandbox');
    expect(lesson.scenarios.map((s: any) => s.id)).toEqual(['kinematics_vectors', 'dynamics_impulse', 'work_energy', 'fundamental_quantities']);
    for (const t of allTrials(lesson)) {
      expect(t.variants, t.id).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        const r = resolveTrial(t, i);
        if (r.input.type === 'choice') expect(r.input.options.map((o) => o.id), `${t.id}/${i}`).toContain(r.answer.choice);
        else for (const f of r.input.fields) expect(typeof r.answer[f.id], `${t.id}/${i}/${f.id}`).toBe('number');
        if (t.anomaly) expect((r.expectedKeywords ?? []).length).toBeGreaterThanOrEqual(3);
        const right = r.input.type === 'choice' ? { choice: r.answer.choice } : Object.fromEntries(r.input.fields.map((f) => [f.id, r.answer[f.id]]));
        expect(scorePrediction(r, right as never).match, `${t.id}/${i}`).toBe(true);
      }
      expect(new Set(t.variants!.map((v) => v.prompt)).size, t.id).toBeGreaterThanOrEqual(4);
    }
  });

  it('keeps the contract tasks and explains every listed concept with a card', () => {
    const ids = allTrials(lesson).map((t) => t.id);
    for (const id of ['kin_1', 'dyn_1', 'dyn_2_anomaly', 'energy_1', 'energy_2_anomaly', 'measure_1']) expect(ids).toContain(id);
    const cards = allTrials(lesson).filter((t: any) => t.concept).map((t: any) => t.concept.title.toLowerCase()).join(' | ');
    for (const c of ['scalar', 'displacement', 'velocity', 'acceleration', 'momentum', 'force', 'impulse', 'work', 'energy', 'power', 'temperature', 'time', 'mass']) expect(cards, c).toContain(c);
    for (const t of allTrials(lesson) as any[]) if (t.concept) expect(t.concept.examples.length, t.id).toBeGreaterThanOrEqual(3);
  });

  it('the contract anomalies are marked and need an explanation', () => {
    expect(allTrials(lesson).filter((t) => t.anomaly).map((t) => t.id)).toEqual(['kin_1', 'acc_2', 'mom_2', 'dyn_2_anomaly', 'wd_2', 'energy_2_anomaly', 'tp_2', 'measure_1']);
    const r = redactMotion(lesson);
    const all = r.scenarios.flatMap((s: any) => s.trials);
    expect(all.filter((t: any) => t.needsExplanation).length).toBe(8);
    expect(all.find((t: any) => t.id === 'sv_1').concept.title).toBe('Scalars and vectors');
    expect(JSON.stringify(r)).not.toContain('"answer"');
  });

  it('computes the physics right', () => {
    for (let i = 0; i < 5; i++) {
      const a = trial('sv_1', i).params as any;
      expect(trial('sv_1', i).answer.disp).toBeCloseTo(Math.hypot(a.a, a.b), 1);
      expect(trial('kin_1', i).answer.choice).toBe('zero');
      const m = trial('mom_1', i).params as any;
      expect(trial('mom_1', i).answer.v).toBeCloseTo((m.m1 * m.v1 + m.m2 * m.v2) / (m.m1 + m.m2), 1);
      const z = trial('mom_2', i).params as any;
      expect(z.m1 * z.v1 + z.m2 * z.v2).toBeCloseTo(0, 6);
      const e = trial('imp_2', i).params as any;
      const p = e.m * Math.sqrt(2 * g * e.h);
      expect(trial('imp_2', i).answer.foam).toBeCloseTo(p / e.tf, 1);
      expect(Number(trial('imp_2', i).answer.conc)).toBeGreaterThan(Number(trial('imp_2', i).answer.foam) * 20);
      const w = trial('pw_1', i).params as any;
      expect(trial('pw_1', i).answer.P).toBeCloseTo((w.m * g * w.h) / w.t, 0);
      const n = trial('nrg_2', i).params as any;
      expect(trial('nrg_2', i).answer.v).toBeCloseTo(Math.sqrt(2 * g * n.h), 1);
      expect(trial('measure_1', i).answer.choice).toBe('weight');
      const q = trial('ms_3', i).params as any;
      expect(trial('ms_3', i).answer.wm).toBeCloseTo(q.m * 1.6, 1);
      expect(trial('tp_1', i).answer.K).toBe((trial('tp_1', i).params as any).c + 273);
    }
  });
});
