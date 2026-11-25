import { describe, expect, it } from 'vitest';
import { dealOptions, pickIndex, rngFor, sample, seededRand, shuffle } from '../questionEngine';

describe('questionEngine', () => {
  it('same (session, lesson) gives the same deal; another session differs', () => {
    const a = shuffle([1, 2, 3, 4, 5, 6, 7, 8], rngFor('s1', 'physics-motion'));
    expect(shuffle([1, 2, 3, 4, 5, 6, 7, 8], rngFor('s1', 'physics-motion'))).toEqual(a);
    expect(shuffle([1, 2, 3, 4, 5, 6, 7, 8], rngFor('s2', 'physics-motion'))).not.toEqual(a);
  });
  it('shuffle keeps the items and does not mutate', () => {
    const xs = [1, 2, 3, 4];
    expect([...shuffle(xs, seededRand(7))].sort()).toEqual(xs);
    expect(xs).toEqual([1, 2, 3, 4]);
  });
  it('pickIndex stays in range', () => {
    const r = seededRand(3);
    for (let i = 0; i < 500; i++) expect(pickIndex(5, r)).toBeLessThan(5);
    expect(pickIndex(1)).toBe(0);
  });
  it('sample returns distinct items', () => {
    expect(new Set(sample(['a', 'b', 'c', 'd', 'e'], 3, seededRand(1))).size).toBe(3);
  });
  it('correct-answer position is balanced over 1000 draws', () => {
    const r = seededRand(42);
    const hits = [0, 0, 0, 0];
    for (let i = 0; i < 1000; i++) hits[dealOptions(['a', 'b', 'c', 'd'], r).indexOf('a')]++;
    for (const h of hits) expect(h).toBeGreaterThan(190);
  });
  it('dealOptions can keep the answer off a slot', () => {
    const r = seededRand(5);
    for (let i = 0; i < 200; i++) expect(dealOptions(['a', 'b', 'c', 'd'], r, 'a', 2).indexOf('a')).not.toBe(2);
  });
});
