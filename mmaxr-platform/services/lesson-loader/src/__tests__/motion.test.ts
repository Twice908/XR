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
