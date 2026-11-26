import { describe, expect, it } from 'vitest';
import { RARITY_RANK } from '../catalog';
import { BASE_ODDS, masteryLevel, PITY_EVERY, rollPack } from '../roll';
import { seeded } from './seeded';

const plain = { lessonId: 'ionic-bonding', scorePercent: 50, firstCompletion: false, packsSinceEpic: 0 };

describe('rollPack', () => {
  it('deals three distinct cards, four on a first completion', () => {
    const rng = seeded(1);
    for (let i = 0; i < 500; i++) {
      const a = rollPack(plain, rng);
      expect(a.cards).toHaveLength(3);
      expect(new Set(a.cards.map((c) => c.card.id)).size).toBe(3);
      expect(a.cards.map((c) => c.slot)).toEqual([1, 2, 3]);
    }
    expect(rollPack({ ...plain, firstCompletion: true }, rng).cards).toHaveLength(4);
  });

  it('matches the published base odds', () => {
    const rng = seeded(2);
    const counts = { common: 0, rare: 0, epic: 0, legendary: 0 };
    const packs = 20_000;
    // packsSinceEpic 0 keeps the pity timer out of the way.
    for (let i = 0; i < packs; i++) for (const c of rollPack(plain, rng).cards) counts[c.card.rarity]++;
    const n = packs * 3;
    for (const r of Object.keys(counts) as (keyof typeof counts)[]) expect(Math.abs(counts[r] / n - BASE_ODDS[r])).toBeLessThan(0.01);
  });

  it('guarantees a Rare or better at a score of 90% or more', () => {
    const rng = seeded(3);
    for (let i = 0; i < 2000; i++) {
      const p = rollPack({ ...plain, scorePercent: 90 }, rng);
      expect(p.tier).toBe('mastery');
      expect(p.cards.some((c) => RARITY_RANK[c.card.rarity] >= RARITY_RANK.rare)).toBe(true);
    }
    expect(rollPack({ ...plain, scorePercent: 89.9 }, rng).tier).toBe('standard');
    expect(rollPack({ ...plain, scorePercent: null }, rng).tier).toBe('standard');
  });

  it('guarantees an Epic or better on every tenth pack without one, and resets the counter', () => {
    const rng = seeded(4);
    for (let i = 0; i < 2000; i++) {
      const p = rollPack({ ...plain, packsSinceEpic: PITY_EVERY - 1 }, rng);
      expect(p.cards.some((c) => RARITY_RANK[c.card.rarity] >= RARITY_RANK.epic)).toBe(true);
      expect(p.packsSinceEpic).toBe(0);
    }
    let since = 0;
    let longest = 0;
    for (let i = 0; i < 5000; i++) {
      since = rollPack({ ...plain, packsSinceEpic: since }, rng).packsSinceEpic;
      longest = Math.max(longest, since);
    }
    expect(longest).toBeLessThan(PITY_EVERY);
  });

  it('leans towards cards from the lesson just finished', () => {
    const rng = seeded(5);
    let tagged = 0;
    let total = 0;
    for (let i = 0; i < 3000; i++) {
      for (const c of rollPack({ ...plain, lessonId: 'cell-explorer' }, rng).cards) {
        total++;
        if (c.card.lessons.includes('cell-explorer')) tagged++;
      }
    }
    let weeklyTagged = 0;
    for (let i = 0; i < 3000; i++) for (const c of rollPack({ ...plain, lessonId: null }, rng).cards) if (c.card.lessons.includes('cell-explorer')) weeklyTagged++;
    expect(tagged / total).toBeGreaterThan((weeklyTagged / total) * 2);
  });
});

describe('masteryLevel', () => {
  it('maps best scores to levels 1-5', () => {
    expect([null, 10, 50, 70, 85, 95, 100].map(masteryLevel)).toEqual([1, 1, 2, 3, 4, 5, 5]);
  });
});
