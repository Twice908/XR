import { describe, expect, it } from 'vitest';
import { CARDS, SETS } from '../catalog';
import { groupOf } from '../catalog/chemistry';

describe('card catalog', () => {
  it('has unique ids and every card belongs to a known set', () => {
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(CARDS.length);
    const sets = new Set(SETS.map((s) => `${s.subject}/${s.set}`));
    for (const c of CARDS) expect(sets.has(`${c.subject}/${c.set}`)).toBe(true);
  });

  it('covers all ten sets, with every rarity represented overall', () => {
    for (const s of SETS) expect(CARDS.filter((c) => c.subject === s.subject && c.set === s.set).length).toBeGreaterThan(5);
    for (const r of ['common', 'rare', 'epic', 'legendary']) expect(CARDS.some((c) => c.rarity === r)).toBe(true);
  });

  it('has all 118 elements in order with the right periodic-table positions', () => {
    const els = CARDS.filter((c) => c.set === 'elements');
    expect(els).toHaveLength(118);
    expect(els.map((c) => c.data.atomicNumber)).toEqual(Array.from({ length: 118 }, (_, i) => i + 1));
    const pos = (sym: string) => {
      const c = els.find((e) => e.data.symbol === sym)!;
      return [c.data.group, c.data.period];
    };
    expect(pos('H')).toEqual([1, 1]);
    expect(pos('He')).toEqual([18, 1]);
    expect(pos('B')).toEqual([13, 2]);
    expect(pos('Fe')).toEqual([8, 4]);
    expect(pos('Au')).toEqual([11, 6]);
    expect(pos('Hf')).toEqual([4, 6]);
    expect(pos('Ra')).toEqual([2, 7]);
    expect(pos('Og')).toEqual([18, 7]);
    expect(groupOf(57)).toBe(3);
    expect(groupOf(103)).toBe(3);
  });

  it('gives every card a valid one-tap question with distinct choices', () => {
    for (const c of CARDS) {
      expect(c.question, c.id).not.toBeNull();
      const q = c.question!;
      expect(new Set(q.choices).size, c.id).toBe(q.choices.length);
      expect(q.choices.length, c.id).toBeGreaterThanOrEqual(2);
      // The answer must never be printed on the card's face.
      expect([c.title, c.subtitle], c.id).not.toContain(q.choices[q.answerIndex]);
      expect(q.answerIndex, c.id).toBeGreaterThanOrEqual(0);
      const v = c.data[c.quizField];
      expect(q.choices[q.answerIndex], c.id).toBe(Array.isArray(v) ? v.join(' → ') : String(v));
    }
  });

  it('gives every physics card a real fun fact, not a generated definition', () => {
    const physics = CARDS.filter((c) => c.subject === 'physics');
    expect(physics).toHaveLength(27);
    for (const c of physics) {
      expect(typeof c.funFact, c.id).toBe('string');
      expect(c.funFact.length, c.id).toBeGreaterThan(20);
      expect(c.funFact, c.id).not.toMatch(/so in base units it is/);
    }
    expect(CARDS.find((c) => c.id === 'phys-base-time')!.funFact).toContain('periods of the radiation');
    expect(CARDS.find((c) => c.id === 'phys-der-power-of-lens')!.data.kind).toBe('unit of optical power');
  });

  it('ties the existing labs to cards', () => {
    for (const lesson of ['atom-builder', 'ionic-bonding', 'cell-explorer', 'physics-motion', 'biology-respiratory']) {
      expect(CARDS.filter((c) => c.lessons.includes(lesson)).length, lesson).toBeGreaterThanOrEqual(5);
    }
  });
});
