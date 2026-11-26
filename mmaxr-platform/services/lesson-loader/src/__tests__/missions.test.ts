import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  answerQuestion,
  atomFacts,
  checkMission,
  cleanShells,
  currentMission,
  finish,
  ionicFacts,
  isMissionsLesson,
  missionsInternal,
  newAssignment,
  nextHint,
  redactMissions,
  type MissionsLesson,
} from '../missions';
import { seededRand } from '../questionEngine';

const load = (id: string): MissionsLesson => JSON.parse(fs.readFileSync(path.join(__dirname, `../../data/${id}.json`), 'utf8'));
const atom = load('atom-builder');
const ionic = load('ionic-bonding');
const cell = load('cell-explorer');
const NOW = 1_700_000_000_000;

/** The build that meets each Atom Builder mission, written as particles. */
const ATOM_BUILDS: Record<string, { protons: number; neutrons: number; shells: number[] }> = {
  'build-carbon-12': { protons: 6, neutrons: 6, shells: [2, 4] },
  'make-na-plus': { protons: 11, neutrons: 12, shells: [2, 8] },
  'build-carbon-14': { protons: 6, neutrons: 8, shells: [2, 4] },
  'make-cl-minus': { protons: 17, neutrons: 18, shells: [2, 8, 8] },
};

/** Answer every question of a just-met mission correctly. */
function answerAll(lesson: MissionsLesson, a: ReturnType<typeof newAssignment>, missionId: string) {
  const m = lesson.missions.find((x) => x.id === missionId)!;
  for (const q of m.questions) {
    const pos = a.order[q.id].indexOf(q.answer);
    const r = answerQuestion(lesson, a, q.id, `p${pos}`, 1200, NOW);
    expect(r).toMatchObject({ correct: true });
  }
}

describe('mission lesson files', () => {
  it.each([
    [atom, 'chemistry_atom_builder', ['build-carbon-12', 'make-na-plus', 'build-carbon-14', 'make-cl-minus'], 8],
    [ionic, 'chemistry_ionic_bonding', ['give-electron', 'join-ions'], 4],
    [cell, 'biology_cell_explorer', ['cx-two-cells', 'cx-cell-wall', 'cx-cell-membrane', 'cx-nucleus', 'cx-ribosomes', 'cx-er', 'cx-golgi', 'cx-lysosomes', 'cx-vacuoles', 'cx-mitochondria', 'cx-chloroplasts', 'cx-recap'], 22],
  ] as const)('%#: keeps MMAXR missions and questions in order', (lesson, type, ids, questions) => {
    expect(lesson.type).toBe(type);
    expect(isMissionsLesson(lesson)).toBe(true);
    expect(lesson.missions.map((m) => m.id)).toEqual(ids);
    expect(lesson.missions.flatMap((m) => m.questions)).toHaveLength(questions);
    for (const q of lesson.missions.flatMap((m) => m.questions)) {
      expect(q.options.map((o) => o.id)).toContain(q.answer);
      expect(q.options.length).toBeLessThanOrEqual(4);
    }
  });

  it('narrates the chemistry labs with recorded audio, and leaves the cell explorer to its bundle', () => {
    for (const m of atom.missions) expect(m.start?.audioUrl).toMatch(/\/assets\/audio\/atom-builder\/.+\.mp3$/);
    for (const m of ionic.missions) expect(m.complete?.audioUrl).toMatch(/\/assets\/audio\/ionic-bonding\/.+\.mp3$/);
    expect(cell.bundleUrl).toBe('/cell-explorer/index.html');
  });

  it('never sends goals, hints or answers to the browser', () => {
    for (const lesson of [atom, ionic, cell]) {
      const text = JSON.stringify(redactMissions(lesson));
      expect(text).not.toContain('"goal"');
      expect(text).not.toContain('"hints"');
      expect(text).not.toContain('"answer"');
      expect(text).not.toContain('"explanation"');
      expect(text).not.toContain('"questions"');
    }
  });
});

describe('atom builds', () => {
  it('works out element, charge and configuration from particles', () => {
    expect(atomFacts({ protons: 11, neutrons: 12, shells: [2, 8, 0] })).toMatchObject({ symbol: 'Na', charge: 1, electrons: 10, massNumber: 23, electronConfiguration: [2, 8], outerShellComplete: true });
  });
  it('refuses shells that break the filling rules', () => {
    expect(cleanShells([1, 1])).toBeNull();
    expect(cleanShells([2, 9])).toBeNull();
    expect(cleanShells([2, 8, 8, 3])).toBeNull();
    expect(atomFacts({ protons: 0, neutrons: 0, shells: [] })).toBeNull();
  });
});

describe('ionic builds', () => {
  it('starts as two neutral atoms and becomes Na+ and Cl- after one transfer', () => {
    expect(ionicFacts({ sodium: [2, 8, 1], chlorine: [2, 8, 7], bonded: false })).toMatchObject({ ions: ['Na', 'Cl'], allOuterShellsComplete: false });
    expect(ionicFacts({ sodium: [2, 8], chlorine: [2, 8, 8], bonded: false })).toMatchObject({ ions: ['Na+', 'Cl-'], allOuterShellsComplete: true, netCharge: 0 });
  });
  it('refuses lost electrons and joins of atoms that are not ions yet', () => {
    expect(ionicFacts({ sodium: [2, 8], chlorine: [2, 8, 7], bonded: false })).toBeNull();
    expect(ionicFacts({ sodium: [2, 8, 1], chlorine: [2, 8, 7], bonded: true })).toBeNull();
  });
});

describe('a full Atom Builder run', () => {
  it('goes mission by mission, unlocking questions only when the goal is met', () => {
    const a = newAssignment(atom, 'stu', seededRand(7));
    expect(checkMission(atom, a, 'make-na-plus', ATOM_BUILDS['make-na-plus'], NOW)).toMatchObject({ status: 409 });

    const miss = checkMission(atom, a, 'build-carbon-12', { protons: 6, neutrons: 6, shells: [2, 3] }, NOW);
    expect(miss).toMatchObject({ met: false, attempts: 1, questions: [] });
    expect(answerQuestion(atom, a, 'assess.atom.carbon12.01', 'p0', 0, NOW)).toMatchObject({ status: 409 });

    for (const m of atom.missions) {
      const r = checkMission(atom, a, m.id, ATOM_BUILDS[m.id], NOW);
      expect(r).toMatchObject({ met: true });
      expect((r as { questions: unknown[] }).questions).toHaveLength(2);
      expect(finish(atom, a, NOW)).toMatchObject({ status: 409 });
      answerAll(atom, a, m.id);
    }
    expect(currentMission(atom, a)).toBeNull();
    expect(finish(atom, a, NOW)).toEqual({ missions: 4, hintsUsed: 0, attempts: 5, correct: 8, total: 8 });

    // What the rubric engine scores from.
    const detail = missionsInternal(atom, a).missionDetail;
    expect(detail.map((m) => m.id)).toEqual(atom.missions.map((m) => m.id));
    expect(detail[0]).toMatchObject({ attempts: 2, hintsUsed: 0, hintsAvailable: 3, met: true });
    expect(detail.flatMap((m) => m.questions).every((q) => q.answered && q.correct)).toBe(true);
  });

  it('hands out hints one at a time, in order, and counts them', () => {
    const a = newAssignment(atom, 'stu', seededRand(1));
    const m = atom.missions[0];
    expect(nextHint(atom, a, m.id)).toMatchObject({ hint: m.hints[0], level: 'nudge', used: 1 });
    expect(nextHint(atom, a, m.id)).toMatchObject({ level: 'clue', used: 2 });
    expect(nextHint(atom, a, m.id)).toMatchObject({ level: 'explanation', used: 3 });
    expect(nextHint(atom, a, m.id)).toMatchObject({ status: 409 });
  });

  it('keeps the first answer and discloses the right option only after answering', () => {
    const a = newAssignment(atom, 'stu', seededRand(3));
    checkMission(atom, a, 'build-carbon-12', ATOM_BUILDS['build-carbon-12'], NOW);
    const q = atom.missions[0].questions[0];
    const wrong = a.order[q.id].findIndex((id) => id !== q.answer);
    const first = answerQuestion(atom, a, q.id, `p${wrong}`, 500, NOW);
    expect(first).toMatchObject({ correct: false, answer: `p${a.order[q.id].indexOf(q.answer)}` });
    expect(answerQuestion(atom, a, q.id, `p${a.order[q.id].indexOf(q.answer)}`, 500, NOW)).toMatchObject({ correct: false });
  });
});

describe('a full Ionic Bonding run', () => {
  it('moves an electron, then joins the ions', () => {
    const a = newAssignment(ionic, 'stu', seededRand(5));
    expect(checkMission(ionic, a, 'give-electron', { sodium: [2, 8, 1], chlorine: [2, 8, 7], bonded: false }, NOW)).toMatchObject({ met: false });
    expect(checkMission(ionic, a, 'give-electron', { sodium: [2, 8], chlorine: [2, 8, 8], bonded: false }, NOW)).toMatchObject({ met: true });
    answerAll(ionic, a, 'give-electron');
    expect(checkMission(ionic, a, 'join-ions', { sodium: [2, 8], chlorine: [2, 8, 8], bonded: true }, NOW)).toMatchObject({ met: true });
    answerAll(ionic, a, 'join-ions');
    expect(finish(ionic, a, NOW)).toMatchObject({ correct: 4, total: 4 });
  });
});

describe('the cell explorer run', () => {
  it('keeps the bundle\'s own option order and follows its chapters', () => {
    const a = newAssignment(cell, 'stu', seededRand(9));
    for (const m of cell.missions) for (const q of m.questions) expect(a.order[q.id]).toEqual(q.options.map((o) => o.id));
    expect(checkMission(cell, a, 'cx-two-cells', { chapter: 'two-cells' }, NOW)).toMatchObject({ met: true, questions: [] });
    expect(checkMission(cell, a, 'cx-cell-wall', { chapter: 'nucleus' }, NOW)).toMatchObject({ met: false });
    expect(checkMission(cell, a, 'cx-cell-wall', { chapter: 'cell-wall' }, NOW)).toMatchObject({ met: true, questions: [{ id: 'assess.cell.wall.01' }, { id: 'assess.cell.wall.02' }] });
  });

  it('tells the coach which questions are still open without their answers leaking to the browser', () => {
    const a = newAssignment(cell, 'stu', seededRand(2));
    const internal = missionsInternal(cell, a);
    expect(internal.kind).toBe('missions');
    expect(internal.tubes.every((t) => t.open)).toBe(true);
  });
});
