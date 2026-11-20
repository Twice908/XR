import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { allTrials, cleanPrediction, observeFor, redactMotion, scoreExplanation, scorePrediction, secretsOf, type MotionPrediction } from '../motion';

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
