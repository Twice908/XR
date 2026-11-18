import { describe, expect, it } from 'vitest';
import { phPaperColor, pickSolutions, reactionColor, redactChemistry, verdictOf } from '../chemistry';

const lesson = {
  lessonId: 'chemistry-101',
  type: 'chemistry_indicators',
  config: { totalTestTubes: 2 },
  indicators: [
    { id: 'litmus', name: 'Litmus', source: 'n', colors: { neutral: 'Purple', acid: 'Red', base: 'Blue' } },
    { id: 'ph_paper', name: 'pH', source: 's', isPhTest: true },
  ],
  solutionPool: [
    { id: 'hcl', name: 'Hydrochloric Acid', formula: 'HCl', type: 'acid', ph: 1 },
    { id: 'naoh', name: 'Sodium Hydroxide', formula: 'NaOH', type: 'base', ph: 14 },
    { id: 'nacl', name: 'Salt Water', formula: 'NaCl', type: 'neutral', ph: 7 },
  ],
  assignedSolutions: [{ id: 'hcl' }],
};

describe('redactChemistry', () => {
  const out = JSON.stringify(redactChemistry(lesson));
  it('removes the pool, the assignment and every answer-bearing field', () => {
    for (const secret of ['Hydrochloric', 'HCl', 'NaOH', 'solutionPool', 'assignedSolutions', '"ph":']) expect(out).not.toContain(secret);
  });
  it('keeps only the neutral colour of each indicator', () => {
    expect(out).toContain('Purple');
    expect(out).not.toContain('Red');
    expect(out).not.toContain('Blue');
  });
  it('still carries what the client needs', () => {
    expect(redactChemistry(lesson).config.totalTestTubes).toBe(2);
    expect(redactChemistry(lesson).indicators.map((i: any) => i.id)).toEqual(['litmus', 'ph_paper']);
  });
});

describe('reactions', () => {
  const [hcl, naoh, nacl] = lesson.solutionPool;
  it('shows the colour for the hidden type', () => {
    expect(reactionColor(lesson.indicators, hcl, 'litmus')).toBe('Red');
    expect(reactionColor(lesson.indicators, naoh, 'litmus')).toBe('Blue');
    expect(reactionColor(lesson.indicators, nacl, 'litmus')).toBe('Purple');
  });
  it('maps pH paper from the hidden pH', () => {
    expect(reactionColor(lesson.indicators, hcl, 'ph_paper')).toBe('Red');
    expect(phPaperColor(7)).toBe('Green');
    expect(phPaperColor(14)).toBe('Purple');
  });
  it('rejects unknown tools', () => {
    expect(reactionColor(lesson.indicators, hcl, 'nope')).toBeNull();
  });
  it('normalises types', () => {
    expect(verdictOf('Alkaline')).toBe('base');
    expect(verdictOf('acid')).toBe('acid');
    expect(verdictOf('salt')).toBe('neutral');
  });
});

describe('pickSolutions', () => {
  it('draws the requested number without repeats', () => {
    const picked = pickSolutions(lesson.solutionPool, 2);
    expect(picked).toHaveLength(2);
    expect(new Set(picked.map((p) => p.id)).size).toBe(2);
  });
});
