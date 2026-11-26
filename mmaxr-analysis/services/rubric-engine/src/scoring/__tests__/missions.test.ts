import { describe, expect, it } from 'vitest';
import { analyze, type EventRow, type MissionsTruth, type TruthInfo } from '..';

let id = 0;
let t = 1_000_000;
const ev = (verb: string, action: string, extra: Partial<NonNullable<EventRow['object_data']>> = {}, dt = 500): EventRow => ({ id: ++id, verb, timestamp: (t += dt), device: 'web', object_data: { action, ...extra } });

interface Plan {
  id: string;
  /** Results of each Check, in order; 'hint' asks for a hint at that point. */
  steps: ('fail' | 'met' | 'hint')[];
  answers: boolean[];
  /** Cell lab: chapters complete themselves (no checks). */
  auto?: boolean;
}

function session(lesson: string, plans: Plan[], submit = true): EventRow[] {
  id = 0;
  t = 1_000_000;
  const out = [ev('investigated', 'enter_lab', { target: lesson })];
  for (const p of plans) {
    const target = `mission:${p.id}`;
    out.push(ev('investigated', 'start_mission', { target }));
    let attempts = 0;
    for (const s of p.steps) {
      if (s === 'hint') out.push(ev('investigated', 'hint', { target, value: 'nudge' }));
      else if (!p.auto) out.push(ev('acted', 'check_mission', { target, value: s === 'met' ? 'met' : 'not_yet', data: { attempts: ++attempts } }));
    }
    out.push(ev('observed', 'mission_complete', { target, value: p.auto ? 0 : attempts }));
    p.answers.forEach((right, i) => out.push(ev('acted', 'quiz_answer', { target: `question:${p.id}.q${i}`, value: right ? 'correct' : 'wrong', data: { tool: 'quiz', match: right, decisionMs: 5000 } })));
  }
  if (submit) out.push(ev('explained', 'submit_analysis'));
  return out;
}

const truthFrom = (labType: MissionsTruth['labType'], plans: Plan[], hints = 3, submitted = true): TruthInfo => ({
  tubes: [],
  submission: null,
  missions: {
    labType,
    submitted,
    missions: plans.map((p) => ({
      id: p.id,
      attempts: p.auto ? 0 : p.steps.filter((s) => s !== 'hint').length,
      hintsUsed: p.steps.filter((s) => s === 'hint').length,
      hintsAvailable: hints,
      met: true,
      questions: p.answers.map((c, i) => ({ id: `${p.id}.q${i}`, answered: true, correct: c, thinkMs: 5000 })),
    })),
  },
});

const score = (r: ReturnType<typeof analyze>, key: string) => r.dimensions.find((d) => d.key === key)!.score;
const ATOM = ['build-carbon-12', 'make-na-plus', 'build-carbon-14', 'make-cl-minus'];

describe('mission labs rubric', () => {
  it('detects each lab instead of mistaking it for the digestive tour', () => {
    expect(analyze(session('atom-builder', []), null).lessonType).toBe('chemistry_atom_builder');
    expect(analyze(session('ionic-bonding', []), null).lessonType).toBe('chemistry_ionic_bonding');
    expect(analyze(session('cell-explorer', [{ id: 'cx-nucleus', steps: [], answers: [true], auto: true }]), null).lessonType).toBe('biology_cell_explorer');
  });

  it('gives full marks to an atom builder run that is right first time, unaided, with every answer right', () => {
    const plans = ATOM.map((m) => ({ id: m, steps: ['met' as const], answers: [true, true] }));
    const r = analyze(session('atom-builder', plans), null, truthFrom('chemistry_atom_builder', plans));
    for (const k of ['predictionDiscipline', 'retrievalEffort', 'revisionQuality', 'causalCoherence', 'metacognitiveCalibration', 'transfer']) expect(score(r, k)).toBe(3);
    expect(r.complete).toBe(true);
    expect(r.overall.percent).toBe(100);
  });

  it('marks down guessing through failed checks, heavy hint use and wrong answers', () => {
    const plans: Plan[] = ATOM.map((m) => ({ id: m, steps: ['fail', 'fail', 'fail', 'fail', 'hint', 'hint', 'hint', 'met'], answers: [false, true] }));
    const r = analyze(session('atom-builder', plans), null, truthFrom('chemistry_atom_builder', plans));
    expect(score(r, 'predictionDiscipline')).toBe(0);
    expect(score(r, 'retrievalEffort')).toBe(0);
    expect(score(r, 'revisionQuality')).toBe(1);
    expect(score(r, 'metacognitiveCalibration')).toBe(0);
    expect(score(r, 'causalCoherence')).toBe(1);
    expect(score(r, 'transfer')).toBeLessThan(2);
  });

  it('credits asking for a hint after a failed check as calibrated', () => {
    const plans: Plan[] = [{ id: 'give-electron', steps: ['fail', 'hint', 'met'], answers: [true, true] }, { id: 'join-ions', steps: ['met'], answers: [true, true] }];
    const r = analyze(session('ionic-bonding', plans), null, truthFrom('chemistry_ionic_bonding', plans));
    expect(score(r, 'metacognitiveCalibration')).toBe(3);
    expect(score(r, 'revisionQuality')).toBe(3);
    expect(score(r, 'transfer')).toBe(3);
  });

  it('scores the cell lab on hints, questions and the recap only', () => {
    const plans: Plan[] = [
      { id: 'cx-nucleus', steps: [], answers: [true, true], auto: true },
      { id: 'cx-golgi', steps: ['hint'], answers: [true, false], auto: true },
      { id: 'cx-recap', steps: [], answers: [true, true], auto: true },
    ];
    const r = analyze(session('cell-explorer', plans), null, truthFrom('biology_cell_explorer', plans, 2));
    expect(score(r, 'predictionDiscipline')).toBeNull();
    expect(score(r, 'revisionQuality')).toBeNull();
    expect(score(r, 'metacognitiveCalibration')).toBeNull();
    expect(score(r, 'retrievalEffort')).toBe(2);
    expect(score(r, 'causalCoherence')).toBe(2);
    expect(score(r, 'transfer')).toBe(3);
    expect(r.overall.max).toBe(9);
  });

  it('still scores from the trace when the lesson service no longer holds the run', () => {
    const plans = ATOM.map((m) => ({ id: m, steps: ['met' as const], answers: [true, true] }));
    const r = analyze(session('atom-builder', plans), null, null);
    expect(score(r, 'causalCoherence')).toBe(3);
    expect(score(r, 'predictionDiscipline')).toBe(3);
    expect(r.metrics.fromServerRecord).toBe(false);
  });

  it('counts unfinished runs against the full maximum', () => {
    const plans = [{ id: 'build-carbon-12', steps: ['met' as const], answers: [true, true] }];
    const r = analyze(session('atom-builder', plans, false), null, truthFrom('chemistry_atom_builder', plans, 3, false));
    expect(r.complete).toBe(false);
    expect(score(r, 'transfer')).toBeNull();
    expect(r.overall.max).toBe(18);
  });
});
