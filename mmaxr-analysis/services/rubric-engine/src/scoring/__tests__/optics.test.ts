import { describe, expect, it } from 'vitest';
import { analyze, type EventRow, type TruthInfo } from '..';

let id = 0;
let t = 1_000_000;
const ev = (verb: string, action: string, extra: Partial<EventRow['object_data']> = {}, dt = 500): EventRow => ({ id: ++id, verb, timestamp: (t += dt), device: 'web', object_data: { action, ...extra } });

/** A student who predicts every trial, waits, fires, and sees the result. */
function session(rights: boolean[], explainWords = 12): EventRow[] {
  id = 0;
  t = 1_000_000;
  const out = [ev('investigated', 'enter_lab', { target: 'physics-light' })];
  rights.forEach((right, i) => {
    const data = { sample: i + 1, tool: i < 8 ? 'case' : 'case' };
    out.push(ev('predicted', 'predict_image', { value: `guess-${i}`, data: { ...data, confidence: right ? 3 : 1, decisionMs: 4000 } }, 300));
    out.push(ev('acted', 'trace_rays', { data }, 3500));
    out.push(ev('observed', 'test_result', { data: { ...data, match: right } }, 10));
  });
  out.push(ev('explained', 'explain', { data: { words: explainWords } }));
  out.push(ev('explained', 'explain', { data: { words: explainWords } }));
  out.push(ev('explained', 'explain', { data: { words: explainWords } }));
  return out;
}

const truth = (over: Partial<NonNullable<TruthInfo['optics']>> = {}): TruthInfo => ({
  tubes: [],
  submission: null,
  optics: {
    plane: { correct: 2, total: 2 },
    rules: { correct: 4, total: 4 },
    cases: [
      { id: 'concave_infinity', mirror: 'concave', anomaly: false, firstScore: 4, finalScore: 4, revised: false },
      { id: 'concave_at_f', mirror: 'concave', anomaly: true, firstScore: 2, finalScore: 4, revised: true },
      { id: 'convex_infinity', mirror: 'convex', anomaly: false, firstScore: 4, finalScore: 4, revised: false },
      { id: 'convex_between_p_infinity', mirror: 'convex', anomaly: false, firstScore: 3, finalScore: 4, revised: true },
    ],
    laws: { correct: 3, total: 3 },
    explanations: { required: 9, given: Array.from({ length: 9 }, (_, i) => ({ kind: 'rule', id: `r${i}`, inputMode: (i % 2 ? 'voice' : 'typed') as 'voice' | 'typed', speakMs: 8000, dwellMs: 20000, thinkMs: 5000, words: 14, pasted: 0, blurs: 0 })) },
    submitted: true,
    ...over,
  },
});
const score = (r: ReturnType<typeof analyze>, key: string) => r.dimensions.find((d) => d.key === key)!.score;

describe('optics rubric', () => {
  it('is detected from the lab the student entered', () => {
    expect(analyze(session([true, true, true]), null, truth()).lessonType).toBe('physics_optics');
  });

  it('rewards a student who revises the anomaly and carries the rules to the convex mirror', () => {
    const r = analyze(session([true, true, true, true]), null, truth());
    expect(score(r, 'revisionQuality')).toBe(3);
    expect(score(r, 'causalCoherence')).toBe(3);
    expect(score(r, 'transfer')).toBe(3);
    expect(score(r, 'predictionDiscipline')).toBeGreaterThanOrEqual(2);
    expect(r.complete).toBe(true);
    expect(r.dimensions.find((d) => d.key === 'revisionQuality')!.basis).toContain('case at F was corrected');
  });

  it('scores nothing for revision, coherence or transfer until the table is locked in', () => {
    const r = analyze(session([true, false, true]), null, truth({ submitted: false, cases: [] }));
    expect(score(r, 'revisionQuality')).toBeNull();
    expect(score(r, 'causalCoherence')).toBeNull();
    expect(score(r, 'transfer')).toBeNull();
    expect(r.complete).toBe(false);
  });

  it('gives no revision credit to a student who never fixed a wrong answer', () => {
    const t0 = truth();
    t0.optics!.cases = t0.optics!.cases.map((c) => ({ ...c, finalScore: c.firstScore, revised: false }));
    expect(score(analyze(session([true, false, true, false]), null, t0), 'revisionQuality')).toBe(0);
  });

  it('does not count explanations that were pasted in or are just padding', () => {
    const honest = score(analyze(session([true, true, true, true]), null, truth()), 'causalCoherence')!;
    const t0 = truth();
    t0.optics!.cases = t0.optics!.cases.map((c) => ({ ...c, finalScore: 1 }));
    t0.optics!.explanations!.given = t0.optics!.explanations!.given.map((g) => ({ ...g, pasted: 400 }));
    const pasted = analyze(session([true, true, true, true]), null, t0);
    expect(score(pasted, 'causalCoherence')!).toBeLessThan(honest);
    expect(pasted.dimensions.find((d) => d.key === 'causalCoherence')!.basis).toContain('looked pasted in');
    expect(pasted.deviceStats.items.find((i) => i.label === 'Pasted into the box')!.value).toBe('9');
  });

  it('shows how the explanations were given to the instructor', () => {
    const r = analyze(session([true, true, true, true]), null, truth());
    expect(r.deviceStats.items.find((i) => i.label === 'Explained aloud')!.value).toBe('4 of 9');
    expect(r.metrics.spokenExplanations).toBe(4);
  });
});
