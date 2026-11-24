import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { allTrials, cleanPrediction, drawVariants, observeFor, redactMotion, resolveTrial, scoreExplanation, scorePrediction, secretsOf, type MotionPrediction } from '../motion';

const lesson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/physics-motion.json'), 'utf8'));
const trial = (id: string) => allTrials(lesson).find((t) => t.id === id)!;

describe('motion contract', () => {
  it('has three modules, unique trial ids, and every answer fits its input', () => {
    expect(lesson.scenarios.map((s: any) => s.id)).toEqual(['kinematics_track', 'dynamics_bay', 'gravitation_drop']);
    const ids = allTrials(lesson).map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of allTrials(lesson)) {
      if (t.input.type === 'choice') expect(t.input.options.map((o) => o.id)).toContain(t.answer.choice);
      else for (const f of t.input.fields) expect(typeof t.answer[f.id]).toBe('number');
      if (t.anomaly && t.expectedKeywords) expect(t.expectedKeywords.length).toBeGreaterThanOrEqual(3);
    }
  });
  it('every asset points at a model file in the shared folder', () => {
    for (const url of Object.values(lesson.assets) as string[]) expect(url).toMatch(/^http:\/\/localhost:3007\/assets\/models\/[\w.-]+\.glb$/);
  });
});

describe.each(['physics-magnetism', 'matter-properties'])('the %s lab uses the same engine', (lessonFile) => {
  const mag = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data', `${lessonFile}.json`), 'utf8'));
  it('has three tabs, every question with five sets of values, and answers that fit their inputs', () => {
    expect(mag.scenarios).toHaveLength(3);
    for (const t of allTrials(mag)) {
      expect(t.variants).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        const r = resolveTrial(t, i);
        if (r.input.type === 'choice') expect(r.input.options.map((o) => o.id)).toContain(r.answer.choice);
        else for (const f of r.input.fields) expect(typeof r.answer[f.id]).toBe('number');
        if (t.anomaly) expect((r.expectedKeywords ?? []).length).toBeGreaterThanOrEqual(3);
        const right = r.input.type === 'choice' ? { choice: r.answer.choice } : Object.fromEntries(r.input.fields.map((f) => [f.id, r.answer[f.id]]));
        expect(scorePrediction(r, right as never).match).toBe(true);
      }
      expect(new Set(t.variants!.map((v) => v.prompt)).size).toBeGreaterThanOrEqual(4);
    }
  });
  it('the browser sees no answers, outcomes, explanations or law names', () => {
    const pub = JSON.stringify(redactMotion(mag));
    for (const t of allTrials(mag)) for (const v of t.variants!) {
      if ((v.outcome as string).length > 14) expect(pub).not.toContain(v.outcome as string);
      expect(pub).not.toContain(v.explanation as string);
    }
    for (const key of ['"answer"', 'expectedKeywords', 'coachSecrets', '"law"', '"laws"']) expect(pub).not.toContain(key);
  });
  it.runIf(lessonFile === 'physics-magnetism')('Fleming answers agree with the left-hand rule (current x field)', () => {
    const t = allTrials(mag).find((x) => x.id === 'force_1')!;
    const dir: Record<string, number[]> = { up: [0, 1, 0], down: [0, -1, 0], left: [-1, 0, 0], right: [1, 0, 0], in: [0, 0, -1], out: [0, 0, 1] };
    for (let i = 0; i < 5; i++) {
      const r = resolveTrial(t, i);
      const I = (r.params as any).current as number[];
      const B = (r.params as any).field as number[];
      const F = [I[1] * B[2] - I[2] * B[1], I[2] * B[0] - I[0] * B[2], I[0] * B[1] - I[1] * B[0]];
      expect(dir[r.answer.choice as string].map((x) => x + 0)).toEqual(F.map((x) => x + 0));
    }
  });
});

describe('variants: every attempt gets different values', () => {
  const withVariants = allTrials(lesson).filter((t) => t.variants);
  it('every question has five sets of values, and each answer fits its own input', () => {
    expect(withVariants.length).toBe(allTrials(lesson).length);
    for (const t of withVariants) {
      expect(t.variants).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        const r = resolveTrial(t, i);
        if (r.input.type === 'choice') expect(r.input.options.map((o) => o.id)).toContain(r.answer.choice);
        else for (const f of r.input.fields) expect(typeof r.answer[f.id]).toBe('number');
        if (t.anomaly) expect((r.expectedKeywords ?? []).length).toBeGreaterThanOrEqual(3);
        expect(r.prompt.length).toBeGreaterThan(20);
        expect(r.outcome.length).toBeGreaterThan(3);
      }
      // the values really differ between sets
      expect(new Set(t.variants!.map((v) => v.prompt)).size).toBeGreaterThanOrEqual(4);
    }
  });
  it('a perfect answer in each set is judged right, and a wrong one is not', () => {
    for (const t of withVariants) {
      for (let i = 0; i < 5; i++) {
        const r = resolveTrial(t, i);
        const right = r.input.type === 'choice' ? { choice: r.answer.choice } : Object.fromEntries(r.input.fields.map((f) => [f.id, r.answer[f.id]]));
        expect(scorePrediction(r, right as never).match).toBe(true);
        if (r.input.type === 'choice') {
          const other = r.input.options.find((o) => o.id !== r.answer.choice)!;
          expect(scorePrediction(r, { choice: other.id }).match).toBe(false);
        }
      }
    }
  });
  it('a session is dealt one set per question and a shuffled option order, and sessions differ', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const a = drawVariants(lesson, rnd);
    const b = drawVariants(lesson, rnd);
    expect(Object.keys(a.variants!).length).toBe(allTrials(lesson).length);
    for (const v of Object.values(a.variants!)) expect(v).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(a.variants)).not.toBe(JSON.stringify(b.variants));
    for (const t of withVariants) {
      const r = resolveTrial(t, a.variants![t.id]);
      if (r.input.type === 'choice') expect([...a.orders![t.id]].sort()).toEqual(r.input.options.map((o) => o.id).sort());
    }
    // over many sessions every set turns up
    const seen = new Map<string, Set<number>>();
    for (let i = 0; i < 300; i++) for (const [id, k] of Object.entries(drawVariants(lesson, rnd).variants!)) seen.set(id, (seen.get(id) ?? new Set()).add(k));
    for (const s of seen.values()) expect(s.size).toBe(5);
  });
  it('the browser gets this session’s values in this session’s order, with no answers from any set', () => {
    const deal = { variants: { kin_1: 2, dyn_1: 4 }, orders: { dyn_1: ['speeds', 'stays', 'slides'] } };
    const pub = redactMotion(lesson, deal as never);
    const trials = pub.scenarios.flatMap((s: any) => s.trials);
    const kin1 = trials.find((t: any) => t.id === 'kin_1');
    expect(kin1.prompt).toContain('reverses 15 m');
    expect(kin1.params).toEqual({ legs: [40, -15] });
    expect(trials.find((t: any) => t.id === 'dyn_1').input.options.map((o: any) => o.id)).toEqual(['speeds', 'stays', 'slides']);
    const text = JSON.stringify(pub);
    for (const t of withVariants) for (const v of t.variants!) {
      // very short outcomes ("15 m.") are trivially inside the questions; the long ones must stay hidden
      if ((v.outcome as string).length > 14) expect(text).not.toContain(v.outcome as string);
      expect(text).not.toContain(v.explanation as string);
    }
    expect(text).not.toContain('"answer"');
  });
  it('without a deal, the default values are used (sessions that began before this existed)', () => {
    const pub = redactMotion(lesson);
    expect(pub.scenarios[0].trials[0].prompt).toContain('forward 50 m');
  });
});

describe('redaction', () => {
  it('shows questions and inputs but no answers, outcomes, explanations, keywords or secrets', () => {
    const text = JSON.stringify(redactMotion(lesson));
    for (const t of allTrials(lesson)) {
      expect(text).not.toContain(t.outcome);
      expect(text).not.toContain(t.explanation);
      for (const s of t.coachSecrets ?? []) expect(text).not.toContain(s);
    }
    for (const key of ['"answer"', 'expectedKeywords', 'keywordSynonyms', 'coachSecrets', '"outcome"', '"explanation"']) expect(text).not.toContain(key);
    expect(text).not.toContain('"tolerance"');
    expect(text).toContain('kin_2');
    expect(text).not.toContain('"law"');
    expect(text).not.toContain('"laws"');
  });
});

describe('prediction scoring', () => {
  it('accepts numbers within tolerance, per field', () => {
    const t = trial('kin_2');
    expect(scorePrediction(t, { distance: 100, displacement: 0 }).match).toBe(true);
    expect(scorePrediction(t, { distance: 95, displacement: 1 }).match).toBe(true);
    const wrong = scorePrediction(t, { distance: 100, displacement: 100 });
    expect(wrong.match).toBe(false);
    expect(wrong.fieldMatch).toEqual({ distance: true, displacement: false });
  });
  it('scores choices exactly', () => {
    expect(scorePrediction(trial('dyn_2'), { choice: 'constant' }).match).toBe(true);
    expect(scorePrediction(trial('dyn_2'), { choice: 'stops' }).match).toBe(false);
  });
  it('rejects malformed predictions', () => {
    expect(cleanPrediction(trial('kin_1'), { distance: 'fifty', displacement: 50 })).toBeNull();
    expect(cleanPrediction(trial('kin_1'), { distance: 50 })).toBeNull();
    expect(cleanPrediction(trial('dyn_1'), { choice: 'hack' })).toBeNull();
    expect(cleanPrediction(trial('dyn_1'), { choice: 'stays' })).toEqual({ choice: 'stays' });
    expect(cleanPrediction(trial('kin_1'), { distance: 50, displacement: 5e9 })).toBeNull();
  });
});

describe('explanations and reveal', () => {
  const pred = (id: string, p: Partial<MotionPrediction> = {}): MotionPrediction => ({ trial: id, value: {}, confidence: 2, thinkMs: 1000, at: 0, match: false, fieldMatch: {}, ...p });
  it('holds an anomaly explanation back until the student has explained', () => {
    expect(observeFor(trial('kin_2'), pred('kin_2')).explanation).toBeNull();
    expect(observeFor(trial('kin_2'), pred('kin_2', { explanation: { text: 'x', coverage: 1, matched: [], missed: [], words: 6, at: 0 } })).explanation).toContain('vector');
    expect(observeFor(trial('kin_1'), pred('kin_1')).explanation).toContain('same size');
  });
  it('credits key ideas and synonyms', () => {
    const good = scoreExplanation(trial('kin_2'), 'Displacement is a vector from the starting point to the end, so coming back gives zero even though the distance was big.');
    expect(good.coverage).toBe(1);
    const thin = scoreExplanation(trial('kin_2'), 'The car went round and ended up in a weird place somehow.');
    expect(thin.coverage).toBeLessThan(0.3);
    expect(scoreExplanation(trial('grav_2'), 'Gravity gives them the same acceleration and the air resistance is gone in a vacuum').coverage).toBe(1);
  });
  it('keeps secrets for the coach, including the correct choice label', () => {
    expect(secretsOf(trial('dyn_2'))).toContain('It keeps going at the same speed');
    expect(secretsOf(trial('kin_2'))).toContain('zero displacement');
  });
});

describe('matter lab: answers agree with the physics', () => {
  const lab = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/matter-properties.json'), 'utf8'));
  const trial = (id: string) => allTrials(lab).find((t) => t.id === id)!;
  const dens = (k: string) => lab.liquids[k].density as number;
  it('the right layering is always densest at the bottom, and every liquid has a distinct density', () => {
    const ds = Object.values<any>(lab.liquids).map((l) => l.density);
    expect(new Set(ds).size).toBe(ds.length);
    for (let i = 0; i < 5; i++) {
      const r = resolveTrial(trial('den_3'), i);
      const keys = (r.params as any).liquids as string[];
      const right = (r.input as any).options.find((o: any) => o.id === 'right').label as string;
      const order = [...keys].sort((a, b) => dens(b) - dens(a)).map((k) => lab.liquids[k].name);
      expect(right).toBe(order.join(' → ') + ' (bottom to top)');
    }
  });
  it('the densest liquid asked about in den_1 really is the densest (or least dense)', () => {
    for (let i = 0; i < 5; i++) {
      const r = resolveTrial(trial('den_1'), i);
      const keys = (r.params as any).liquids as string[];
      const most = /highest/.test(r.prompt);
      const pick = [...keys].sort((a, b) => (most ? dens(b) - dens(a) : dens(a) - dens(b)))[0];
      expect(r.answer.choice).toBe(pick);
    }
  });
  it('density questions give consistent numbers (mass = density × volume)', () => {
    const d = resolveTrial(trial('den_2'), 1);
    expect((d.answer as any).mass).toBeCloseTo(dens('honey') * 80, 1);
    const w = resolveTrial(trial('den_2'), 3);
    expect((w.answer as any).volume).toBe(50);
  });
  it('floating: an object floats exactly when it is less dense than the liquid', () => {
    for (let i = 0; i < 5; i++) {
      const r = resolveTrial(trial('den_4'), i);
      const [, od, ld] = /density ([\d.]+) g\/mL\).*?\(density ([\d.]+) g\/mL/.exec(r.prompt)!.map(Number);
      expect(r.answer.choice).toBe(od < ld ? 'float' : 'sink');
    }
  });
  it('mass is conserved in every sealed or melting variant, and falls only in the open-boil one', () => {
    const answers = [0, 1, 2, 3, 4].map((i) => resolveTrial(trial('state_1'), i));
    expect(answers.map((a) => a.answer.choice ?? 'n')).toEqual(['same', 'n', 'n', 'same', 'down']);
    expect((answers[1].answer as any).mass).toBe(300);
    expect((answers[2].answer as any).mass).toBe(360);
  });

  describe("Archimedes' principle questions", () => {
    const dl = (k: string) => (k === 'iron' ? 7.87 : k === 'aluminium' ? 2.7 : k === 'lead' ? 11.34 : k === 'steel' ? 7.85 : k === 'copper' ? 8.96 : k === 'wood' ? 0.6 : k === 'cork' ? 0.24 : k === 'wax' ? 0.9 : 1.8);
    it('are added after the density questions, which are untouched', () => {
      const ids = lab.scenarios[2].trials.map((t: any) => t.id);
      expect(ids.slice(0, 5)).toEqual(['den_1', 'den_2', 'den_3', 'den_4', 'tr_den']);
      expect(ids.slice(5)).toEqual(['arch_1', 'arch_2', 'arch_3', 'arch_4', 'arch_5', 'tr_arch']);
    });
    it('displacement: a floater pushes out its weight of liquid, a sinker its own volume', () => {
      for (let i = 0; i < 5; i++) {
        const r: any = resolveTrial(trial('arch_1'), i);
        const liq = dens(r.params.liquid);
        const d = (o: any) => (o.density >= liq ? o.side ** 3 : (o.density * o.side ** 3) / liq);
        const da = d(r.params.a);
        const db = d(r.params.b);
        const right = Math.abs(da - db) < 0.5 ? 'same' : da > db ? 'a' : 'b';
        expect(r.answer.choice).toBe(right);
      }
    });
    it('scale readings: weight in air minus the buoyant force, g = 9.8', () => {
      for (let i = 1; i < 5; i++) {
        const r: any = resolveTrial(trial('arch_2'), i);
        const { object, volume, liquid } = r.params;
        expect(r.answer.reading).toBeCloseTo(((dl(object) - dens(liquid)) * volume * 9.8) / 1000, 1);
      }
      expect(resolveTrial(trial('arch_2'), 0).answer.choice).toBe('down');
    });
    it('equal volumes lose equal weight, and the buoyant-force sums are right', () => {
      for (let i = 0; i < 5; i++) {
        const r: any = resolveTrial(trial('arch_4'), i);
        expect(r.answer.force).toBeCloseTo((dens(r.params.liquid) * r.params.volume * 9.8) / 1000, 1);
      }
      for (const i of [0, 1, 4]) expect(resolveTrial(trial('arch_3'), i).answer.choice).toBe('same');
      expect(resolveTrial(trial('arch_3'), 2).answer.choice).toBe('water');
      expect(resolveTrial(trial('arch_3'), 3).answer.choice).toBe('double');
    });
    it('a clay boat floats exactly when its hull can displace its own weight of liquid', () => {
      for (let i = 0; i < 5; i++) {
        const r: any = resolveTrial(trial('arch_5'), i);
        expect(r.answer.choice).toBe(r.params.hull >= r.params.mass / dens(r.params.liquid) ? 'float' : 'sink');
      }
    });
  });
});
