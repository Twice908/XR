import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { OpticsLessonContract } from '@mmaxr/schema';
import { allTrialsDone, buildReveal, checkExplanation, cleanTable, flatCases, judgeTrial, makePlan, meetsAnchors, needsExplanation, numberWords, owesExplanation, personalize, redactOptics, stageBlocker, trialKey, truthFor, type OpticsAssignment, type OpticsTrial } from '../optics';

const raw: OpticsLessonContract = JSON.parse(fs.readFileSync(path.join(__dirname, '../../data/physics-light.json'), 'utf8'));

/** A small deterministic generator so each test sees a fixed session. */
const seeded = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
};
const session = (seed: number) => {
  const plan = makePlan(raw, seeded(seed));
  const lesson = personalize(raw, plan);
  const a: OpticsAssignment = { kind: 'optics', lessonId: lesson.lessonId, studentId: 's', plan, trials: {}, submission: null, createdAt: 0 };
  return { plan, lesson, a };
};

const T0 = 1_000_000;
const record = (lesson: OpticsLessonContract, a: OpticsAssignment, kind: 'plane' | 'law' | 'rule' | 'case', id: string, prediction: Record<string, string>) => {
  const j = judgeTrial(lesson, kind, id, prediction)!;
  const t: OpticsTrial = { kind, id, prediction: j.stored, confidence: 2, thinkMs: 1000, at: T0, resultAt: T0, match: j.result.match, score: j.score };
  a.trials[trialKey(kind, id)] = t;
  return t;
};
const right = (lesson: OpticsLessonContract, kind: 'plane' | 'law' | 'rule', id: string): Record<string, string> =>
  ({ outcome: kind === 'plane' ? lesson.planeMirror.scenarios.find((s) => s.id === id)!.result! : kind === 'law' ? lesson.lawsOfReflection.laws.find((l) => l.id === id)!.answer! : lesson.rayRules.rules.find((r) => r.id === id)!.reflected! });
const explain = (lesson: OpticsLessonContract, a: OpticsAssignment, t: OpticsTrial, text: string, extra: Record<string, unknown> = {}, at = T0 + 20_000) => {
  const r = checkExplanation(lesson, a, t.kind, t.id, { text, inputMode: 'typed', speakMs: 0, thinkMs: 5000, pasted: 0, blurs: 0, ...extra }, at);
  if ('explanation' in r) t.explanation = r.explanation;
  return r;
};
/** Everything run correctly and explained with the session's own numbers. */
const everything = (lesson: OpticsLessonContract, a: OpticsAssignment) => {
  for (const s of lesson.planeMirror.scenarios) explain(lesson, a, record(lesson, a, 'plane', s.id, right(lesson, 'plane', s.id)), `On the ${s.id === 'smooth' ? 'smooth mirror' : 'crumpled foil'} the beams behaved just as I expected from the surface`);
  for (const l of lesson.lawsOfReflection.laws) explain(lesson, a, record(lesson, a, 'law', l.id, right(lesson, 'law', l.id)), `With ${l.incidentAngleDeg} degrees at the mirror the reflected beam left exactly as predicted`);
  for (const r of lesson.rayRules.rules) explain(lesson, a, record(lesson, a, 'rule', r.id, right(lesson, 'rule', r.id)), `The ray at ${r.params.n} went where I thought, I traced it with the diagram`);
  for (const c of flatCases(lesson)) record(lesson, a, 'case', c.id, c.expected);
};

describe('physics-light data', () => {
  it('has the 6 concave and 2 convex conditions, with exactly one anomaly at F', () => {
    const cases = flatCases(raw);
    expect(cases.filter((c) => c.mirror === 'concave')).toHaveLength(6);
    expect(cases.filter((c) => c.mirror === 'convex')).toHaveLength(2);
    expect(cases.filter((c) => c.anomaly).map((c) => c.id)).toEqual(['concave_at_f']);
  });
  it('every answer is one of the offered options', () => {
    for (const c of flatCases(raw)) for (const f of Object.keys(c.expected) as (keyof typeof c.expected)[]) expect(raw.imageFields[f].map((o) => o.id)).toContain(c.expected[f]);
    for (const r of raw.rayRules.rules) expect(raw.rayRules.outcomes.map((o) => o.id)).toContain(r.reflected);
    for (const s of raw.planeMirror.scenarios) expect(raw.planeMirror.predictionOptions.map((o) => o.id)).toContain(s.result);
    for (const l of raw.lawsOfReflection.laws) expect(l.options.map((o) => o.id)).toContain(l.answer);
  });
  it('offers a pool of 8 to draw each law and ray from', () => {
    for (const l of raw.lawsOfReflection.laws) expect(l.variants).toHaveLength(8);
    for (const r of raw.rayRules.rules) expect(r.variants).toHaveLength(8);
  });
  it('every angle gives four different answer options for the first law', () => {
    const law = raw.lawsOfReflection.laws[0];
    for (const v of law.variants!) {
      const labels = law.options.map((o) => o.label.replace(/\{(\w+)\}/g, (_, k) => String({ i: v.i, c: 90 - v.i, p: v.i + 20, m: v.i - 18 }[k as 'i'])));
      expect(new Set(labels).size, `i=${v.i}`).toBe(4);
    }
  });
});

describe('a run of its own for every session', () => {
  it('draws different angles, orders and option sequences from one session to the next', () => {
    const runs = Array.from({ length: 12 }, (_, i) => personalize(raw, makePlan(raw, seeded(i + 1))));
    const angles = new Set(runs.map((l) => l.lawsOfReflection.laws.find((x) => x.id === 'law_angle')!.incidentAngleDeg));
    const lawOrders = new Set(runs.map((l) => l.lawsOfReflection.laws.map((x) => x.id).join()));
    const ruleOrders = new Set(runs.map((l) => l.rayRules.rules.map((x) => x.id).join()));
    const firstOptions = new Set(runs.map((l) => l.lawsOfReflection.laws[0].options.map((o) => o.id).join()));
    expect(angles.size).toBeGreaterThan(3);
    expect(lawOrders.size).toBeGreaterThan(2);
    expect(ruleOrders.size).toBeGreaterThan(3);
    expect(firstOptions.size).toBeGreaterThan(3);
  });
  it('the right answer lands in every position over many sessions', () => {
    const seen = new Set<number>();
    for (let i = 1; i <= 60; i++) {
      const l = personalize(raw, makePlan(raw, seeded(i * 7))).lawsOfReflection.laws.find((x) => x.id === 'law_angle')!;
      seen.add(l.options.findIndex((o) => o.id === l.answer));
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });
  it('fills this session\'s numbers into the wording and the options', () => {
    const l = personalize(raw, makePlan(raw, seeded(3))).lawsOfReflection.laws.find((x) => x.id === 'law_angle')!;
    expect(l.incident).toContain(`${l.incidentAngleDeg}°`);
    expect(l.incident).not.toMatch(/\{/);
    expect(l.options.find((o) => o.id === l.answer)!.label).toBe(`${l.incidentAngleDeg}°`);
  });
  it('keeps every candle in its zone, so the textbook answer stays right', () => {
    for (let i = 1; i <= 40; i++) {
      const lesson = personalize(raw, makePlan(raw, seeded(i * 13)));
      const u = (id: string) => lesson.sphericalMirrors.flatMap((m) => m.cases).find((c) => c.id === id)!.uOverF!;
      expect(u('concave_beyond_c')).toBeGreaterThan(2);
      expect(u('concave_between_c_f')).toBeGreaterThan(1);
      expect(u('concave_between_c_f')).toBeLessThan(2);
      expect(u('concave_between_f_p')).toBeLessThan(1);
      expect(u('convex_between_p_infinity')).toBeGreaterThan(1);
      expect(u('concave_at_f')).toBe(1);
      expect(u('concave_at_c')).toBe(2);
    }
  });
  it('still has six concave and two convex cases and one anomaly, however shuffled', () => {
    const lesson = personalize(raw, makePlan(raw, seeded(99)));
    expect(flatCases(lesson).filter((c) => c.mirror === 'concave')).toHaveLength(6);
    expect(flatCases(lesson).filter((c) => c.anomaly)).toHaveLength(1);
  });
});

describe('redactOptics', () => {
  it('leaks no answer, expected image, anomaly flag, anchor, rule text or use', () => {
    const { lesson } = session(5);
    const text = JSON.stringify(redactOptics(lesson));
    for (const secret of ['"result"', '"reflected"', '"answer"', '"anchors"', '"statement"', '"description"', '"variants"', 'expectedImage', 'isAnomaly', 'anomalyExplanation', '"uses"', 'cannot be caught on a screen', 'First law', 'reflects through F']) expect(text, secret).not.toContain(secret);
  });
  it('keeps what only places things: angles, offsets, sides, candle distances', () => {
    const r = redactOptics(session(5).lesson);
    expect(typeof r.lawsOfReflection.laws[0].incidentAngleDeg).toBe('number');
    expect(r.lawsOfReflection.laws[0].side).toMatch(/left|right/);
    expect(typeof r.rayRules.rules[0].params.n).toBe('number');
    expect(r.rayRules.rules[0].options).toHaveLength(4);
  });
});

describe('judgeTrial', () => {
  it('grades surfaces, laws and rules by option', () => {
    const { lesson } = session(2);
    expect(judgeTrial(lesson, 'plane', 'smooth', right(lesson, 'plane', 'smooth'))!.result.match).toBe(true);
    expect(judgeTrial(lesson, 'plane', 'rough', right(lesson, 'plane', 'smooth'))!.result.match).toBe(false);
    expect(judgeTrial(lesson, 'law', 'law_angle', right(lesson, 'law', 'law_angle'))!.result.match).toBe(true);
    expect(judgeTrial(lesson, 'law', 'law_angle', { outcome: 'a' })!.result.match).toBe(false);
    expect(judgeTrial(lesson, 'rule', 'rule3', right(lesson, 'rule', 'rule3'))!.result.match).toBe(true);
    expect(judgeTrial(lesson, 'law', 'law_angle', { outcome: 'zzz' })).toBeNull();
    expect(judgeTrial(lesson, 'rule', 'rule1', { outcome: 'bogus' })).toBeNull();
  });
  it('grades an image field by field and only explains the anomaly on the anomalous case', () => {
    const { lesson } = session(2);
    const j = judgeTrial(lesson, 'case', 'concave_at_f', { position: 'beyond_c', size: 'highly_enlarged', nature: 'real', orientation: 'erect' })!;
    expect(j.result.fields).toEqual({ position: false, size: true, nature: true, orientation: false });
    expect(j.result.anomaly).toBe(true);
    expect(j.result.explanation).toContain('infinity');
    expect(judgeTrial(lesson, 'case', 'concave_at_c', { position: 'at_c', size: 'same_size', nature: 'real', orientation: 'inverted' })!.result.explanation).toBe('');
  });
});

describe('explanations', () => {
  const setup = () => {
    const s = session(4);
    const t = record(s.lesson, s.a, 'law', 'law_angle', right(s.lesson, 'law', 'law_angle'));
    const angle = s.lesson.lawsOfReflection.laws.find((l) => l.id === 'law_angle')!.incidentAngleDeg;
    return { ...s, t, angle };
  };
  it('an image explanation is owed only when the first prediction missed; everything else always', () => {
    const { lesson, a } = session(4);
    expect(needsExplanation(record(lesson, a, 'plane', 'smooth', right(lesson, 'plane', 'smooth')))).toBe(true);
    expect(needsExplanation(record(lesson, a, 'law', 'law_angle', right(lesson, 'law', 'law_angle')))).toBe(true);
    expect(needsExplanation(record(lesson, a, 'case', 'concave_at_c', { position: 'at_c', size: 'same_size', nature: 'real', orientation: 'inverted' }))).toBe(false);
    expect(needsExplanation(record(lesson, a, 'case', 'concave_at_f', { position: 'at_f', size: 'enlarged', nature: 'real', orientation: 'inverted' }))).toBe(true);
  });
  it('is refused when too short or too quick, without saying what the answer is', () => {
    const { lesson, a, t, angle } = setup();
    const short = explain(lesson, a, t, `${angle} degrees`);
    expect(short).toMatchObject({ error: expect.stringMatching(/at least/) });
    const quick = explain(lesson, a, t, `The beam came in at ${angle} degrees and went out the other way`, {}, T0 + 2000);
    expect(quick).toMatchObject({ error: expect.stringMatching(/moment/) });
    for (const r of [short, quick]) expect(JSON.stringify(r)).not.toContain(String(angle));
  });
  it('is accepted with this session\'s number as digits or words, and kept as first given', () => {
    const { lesson, a, t, angle } = setup();
    const ok = explain(lesson, a, t, `I saw the beam hit at ${angle} and it left on the far side at the same angle`);
    expect(ok).toHaveProperty('explanation');
    expect(owesExplanation(a)).toBeNull();
    const again = checkExplanation(lesson, a, 'law', 'law_angle', { text: 'completely different words that are many and long enough' }, T0 + 99_000);
    expect(again).toHaveProperty('explanation.text', expect.stringContaining('I saw the beam'));
    const s2 = session(4);
    const t2 = record(s2.lesson, s2.a, 'law', 'law_angle', right(s2.lesson, 'law', 'law_angle'));
    expect(explain(s2.lesson, s2.a, t2, `It arrived at ${numberWords(angle)} degrees and left on the far side`)).toHaveProperty('explanation');
  });
  it('a spoken explanation needs a real recording, and typing is recorded as typing', () => {
    const { lesson, a, t, angle } = setup();
    const said = `I aimed at ${angle} degrees and watched the beam bounce away on the other side`;
    expect(explain(lesson, a, t, said, { inputMode: 'voice', speakMs: 1000 })).toMatchObject({ error: expect.stringMatching(/too short/) });
    const ok = explain(lesson, a, t, said, { inputMode: 'voice', speakMs: 9000, pasted: 0, blurs: 2 });
    expect(ok).toHaveProperty('explanation.inputMode', 'voice');
    expect(ok).toHaveProperty('explanation.blurs', 2);
  });
  it('accepts an explanation without the setup number, and records whether it was used', () => {
    const { lesson, a, t, angle } = setup();
    const without = explain(lesson, a, t, 'The beam bounced off and went away on the other side just as I thought it would');
    expect(without).toHaveProperty('explanation.usedSetup', false);
    const { lesson: l2, a: a2, t: t2 } = setup();
    expect(explain(l2, a2, t2, `I aimed at ${angle} degrees and watched the beam bounce away on the other side`)).toHaveProperty('explanation.usedSetup', true);
  });
  it('anchors match whole numbers only', () => {
    expect(meetsAnchors('it was 140 degrees', [['40']])).toBe(false);
    expect(meetsAnchors('it was 40° exactly', [['40']])).toBe(true);
    expect(meetsAnchors('forty-two degrees', [['42']])).toBe(true);
    expect(meetsAnchors('from the LEFT side', [['{i}'.replace('{i}', '99'), 'left']])).toBe(true);
  });
  it('blocks the next run until the last one is explained', () => {
    const { lesson, a } = session(4);
    record(lesson, a, 'plane', 'smooth', right(lesson, 'plane', 'smooth'));
    expect(stageBlocker(lesson, a, 'plane', 'rough')).toMatch(/Explain/);
  });
});

describe('stage order', () => {
  it('surfaces, then laws, then rules, then concave, then convex, with each run explained', () => {
    const { lesson, a } = session(6);
    const step = (kind: 'plane' | 'law' | 'rule', id: string, text: string) => explain(lesson, a, record(lesson, a, kind, id, right(lesson, kind, id)), text);
    expect(stageBlocker(lesson, a, 'law', 'law_angle')).toMatch(/surfaces/);
    for (const s of lesson.planeMirror.scenarios) step('plane', s.id, `The ${s.id === 'smooth' ? 'smooth mirror' : 'crumpled foil'} gave me the result I predicted after looking`);
    expect(stageBlocker(lesson, a, 'law', 'law_angle')).toBeNull();
    expect(stageBlocker(lesson, a, 'rule', 'rule1')).toMatch(/laws/);
    for (const l of lesson.lawsOfReflection.laws) step('law', l.id, `At ${l.incidentAngleDeg} degrees from the ${l.side} I saw exactly what I predicted`);
    expect(stageBlocker(lesson, a, 'rule', 'rule1')).toBeNull();
    expect(stageBlocker(lesson, a, 'case', 'concave_at_c')).toMatch(/rules/);
    for (const r of lesson.rayRules.rules) step('rule', r.id, `The ray at ${r.params.n} did what I thought it would do here`);
    expect(stageBlocker(lesson, a, 'case', 'concave_at_c')).toBeNull();
    expect(stageBlocker(lesson, a, 'case', 'convex_infinity')).toMatch(/concave/);
    for (const c of flatCases(lesson).filter((x) => x.mirror === 'concave')) record(lesson, a, 'case', c.id, c.expected);
    expect(stageBlocker(lesson, a, 'case', 'convex_infinity')).toBeNull();
  });
});

describe('lock-in', () => {
  it('needs every run done and explained, then discloses the table, the laws and the uses', () => {
    const { lesson, a } = session(8);
    const t = record(lesson, a, 'plane', 'smooth', right(lesson, 'plane', 'smooth'));
    expect(allTrialsDone(lesson, a)).toBe(false);
    void t;
    const b = session(8);
    everything(b.lesson, b.a);
    expect(allTrialsDone(b.lesson, b.a)).toBe(true);
    b.a.submission = { table: cleanTable({ concave_at_f: { position: 'at_c', size: 'same_size', nature: 'real', orientation: 'inverted' } }, b.lesson, b.a), notes: {}, submittedAt: 1 };
    const r = buildReveal(b.lesson, b.a);
    expect(r.cases).toHaveLength(8);
    expect(r.tableCorrect).toBe(7);
    expect(r.lawsCorrect).toBe(3);
    expect(r.laws.map((l) => l.statement).join(' ')).toMatch(/angle of incidence is equal to the angle of reflection/);
    expect(r.uses[1].examples.join(' ')).toMatch(/rear-view/i);
  });
  it('truth records how each explanation was given', () => {
    const { lesson, a } = session(8);
    everything(lesson, a);
    const t = a.trials[trialKey('plane', 'smooth')];
    t.explanation!.pasted = 120;
    const truth = truthFor(lesson, a);
    expect(truth.explanations.required).toBe(9);
    expect(truth.explanations.given.find((g) => g.id === 'smooth')).toMatchObject({ inputMode: 'typed', pasted: 120 });
    expect(truth.laws).toEqual({ correct: 3, total: 3 });
  });
});
