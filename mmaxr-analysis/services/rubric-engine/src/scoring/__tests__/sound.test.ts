import { describe, expect, it } from 'vitest';
import { analyze, type EventRow, type TruthInfo } from '..';

let id = 0;
let t = 1_000_000;
const ev = (verb: string, action: string, extra: Partial<EventRow['object_data']> = {}, dt = 500): EventRow => ({ id: ++id, verb, timestamp: (t += dt), device: 'web', object_data: { action, ...extra } });

function session(rights: boolean[], noticed = false): EventRow[] {
  id = 0;
  t = 1_000_000;
  const out = [ev('investigated', 'enter_lab', { target: 'physics-sound' })];
  rights.forEach((right, i) => {
    const data = { sample: (i % 2) + 1, tool: ['wave', 'echo', 'sonar'][Math.floor(i / 2)] };
    out.push(ev('predicted', 'predict_sound', { value: `opt-${i}`, data: { ...data, confidence: right ? 3 : 1, decisionMs: 4000 } }, 300));
    out.push(ev('acted', 'run_task', { data }, 3500));
    out.push(ev('observed', 'test_result', { data: { ...data, match: right } }, 10));
  });
  if (noticed) out.push(ev('noticed_anomaly', 'anomaly_frequency'));
  return out;
}

const task = (idv: string, tool: 'wave' | 'echo' | 'sonar', over: Record<string, unknown> = {}) => ({ id: idv, tool, match: true, anomaly: idv === 'wave_1', hasCalc: idv === 'sonar_1', calcAttempts: idv === 'sonar_1' ? 1 : 0, calcOk: idv === 'sonar_1', ...over });
const truth = (over: Partial<NonNullable<TruthInfo['sound']>> = {}, tasks = [task('wave_1', 'wave'), task('wave_2', 'wave'), task('echo_1', 'echo'), task('echo_2', 'echo'), task('sonar_1', 'sonar'), task('ultrasound_1', 'sonar')]): TruthInfo => ({
  tubes: [],
  submission: null,
  sound: {
    tasks: tasks as never,
    total: 6,
    explanations: { required: 6, given: tasks.map((x, i) => ({ id: x.id, inputMode: (i % 2 ? 'voice' : 'typed') as 'voice' | 'typed', speakMs: 8000, dwellMs: 20000, thinkMs: 4000, words: 14, pasted: 0, blurs: 0 })) },
    submitted: true,
    ...over,
  },
});
const score = (r: ReturnType<typeof analyze>, key: string) => r.dimensions.find((d) => d.key === key)!.score;

describe('sound rubric', () => {
  it('is detected from the lab entered', () => {
    expect(analyze(session([true, true]), null, truth()).lessonType).toBe('physics_waves_sound');
  });
  it('gives full marks to accurate, explained, first-time-right work', () => {
    const r = analyze(session([true, true, true, true, true, true]), null, truth());
    expect(score(r, 'causalCoherence')).toBe(3);
    expect(score(r, 'revisionQuality')).toBe(3);
    expect(score(r, 'transfer')).toBe(3);
    expect(r.complete).toBe(true);
  });
  it('scores nothing for revision, coherence or completion until the sandbox is finished', () => {
    const r = analyze(session([true, false]), null, truth({ submitted: false }));
    expect(score(r, 'revisionQuality')).toBeNull();
    expect(score(r, 'causalCoherence')).toBeNull();
    expect(r.complete).toBe(false);
  });
  it('credits a student who explains a wrong prediction properly and notices the anomaly', () => {
    const tasks = [task('wave_1', 'wave', { match: false }), task('wave_2', 'wave'), task('echo_1', 'echo'), task('echo_2', 'echo'), task('sonar_1', 'sonar'), task('ultrasound_1', 'sonar')];
    const noticed = analyze(session([false, true, true, true, true, true], true), null, truth({}, tasks));
    const missed = analyze(session([false, true, true, true, true, true], false), null, truth({}, tasks));
    expect(score(noticed, 'revisionQuality')).toBe(3);
    expect(score(missed, 'revisionQuality')!).toBeLessThan(3);
    expect(missed.dimensions.find((d) => d.key === 'revisionQuality')!.basis).toContain('not flagged');
  });
  it('counts a corrected calculation as revision, and several slips as weaker transfer', () => {
    const tasks = [task('wave_1', 'wave'), task('wave_2', 'wave'), task('echo_1', 'echo'), task('echo_2', 'echo', { match: false }), task('sonar_1', 'sonar', { calcAttempts: 3 }), task('ultrasound_1', 'sonar')];
    const r = analyze(session([true, true, true, false, true, true]), null, truth({}, tasks));
    expect(score(r, 'transfer')).toBe(0);
    expect(r.dimensions.find((d) => d.key === 'revisionQuality')!.basis).toContain('corrected');
  });
  it('does not count pasted explanations, and shows the instructor how they were given', () => {
    const t0 = truth();
    t0.sound!.explanations.given = t0.sound!.explanations.given.map((g) => ({ ...g, pasted: 300 }));
    const honest = analyze(session([true, true, true, true, true, true]), null, truth());
    const pasted = analyze(session([true, true, true, true, true, true]), null, t0);
    expect(score(pasted, 'causalCoherence')!).toBeLessThan(score(honest, 'causalCoherence')!);
    expect(pasted.deviceStats.items.find((i) => i.label === 'Pasted into the box')!.value).toBe('6');
    expect(honest.deviceStats.items.find((i) => i.label === 'Explained aloud')!.value).toBe('3 of 6');
  });
});
