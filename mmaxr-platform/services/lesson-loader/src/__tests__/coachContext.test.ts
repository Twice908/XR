import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { buildCoachContext } from '../coachContext';

const dataDir = path.join(__dirname, '../../data');
const narrationDir = path.join(__dirname, '../../../../../mmaxr-assets/narration');
const lessons = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')));
const narrationFor = (id: string) => {
  const f = path.join(narrationDir, `${id}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};
const contextOf = (id: string) => buildCoachContext(lessons.find((l) => l.lessonId === id), narrationFor(id));

describe('coach context', () => {
  it('builds for every lesson, within the size cap', () => {
    for (const l of lessons) {
      const c = buildCoachContext(l, narrationFor(l.lessonId));
      expect(c).toContain(l.title);
      expect(c.length).toBeLessThanOrEqual(6000);
    }
  });

  it("carries a lab's benches, concept ideas and narration", () => {
    const c = contextOf('physics-fundamentals');
    expect(c).toContain('Bench "Kinematics & Vectors"');
    expect(c).toContain('Concept card "Scalars and vectors"');
    expect(c).toContain("What the lab's narrator tells the student");
  });

  it('never carries concept-card examples or formulas (they can spell out an answer)', () => {
    const c = contextOf('physics-fundamentals');
    expect(c).not.toContain('5 m arrow');
    expect(c).not.toContain('vector = size + direction');
  });

  it('never carries indicator colours, test outcomes or quiz options', () => {
    const chem = lessons.find((l) => l.lessonId === 'chemistry-101');
    const chemCtx = contextOf('chemistry-101')
    const names = chem.indicators.map((i: { name: string }) => i.name).join(' ')
    for (const i of chem.indicators) for (const colour of Object.values(i.colors ?? {}) as string[]) if (!names.includes(colour)) expect(chemCtx).not.toContain(colour);
    const metals = lessons.find((l) => l.lessonId === 'metals-101');
    const metalsCtx = contextOf('metals-101');
    for (const tool of metals.tools) for (const o of tool.outcomes ?? []) expect(metalsCtx).not.toContain(o.label);
    const bio = lessons.find((l) => l.lessonId === 'biology-101');
    const bioCtx = contextOf('biology-101');
    const stopNames = bio.checkpoints.map((cp: { organName: string }) => cp.organName).join(' ')
    for (const cp of bio.checkpoints) for (const q of cp.quiz ?? []) for (const o of q.options ?? []) if (!stopNames.includes(o.label)) expect(bioCtx).not.toContain(o.label);
  });

  it("never carries a trial's prompt, answer or explanation", () => {
    for (const l of lessons) {
      const c = buildCoachContext(l, narrationFor(l.lessonId));
      for (const s of l.scenarios ?? []) {
        for (const t of s.trials ?? s.tasks ?? []) {
          for (const field of [t.prompt, t.explanation, typeof t.answer === 'string' ? t.answer : null]) {
            if (typeof field === 'string' && field.length > 30) expect(c).not.toContain(field.slice(0, 60));
          }
        }
      }
    }
  });
});
