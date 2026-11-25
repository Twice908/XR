/*
 * The one question engine every lab draws from: a seeded random source, shuffling, variant picking and
 * option dealing. Labs differ in what they deal (motion trials, optics plans, sound tasks, tube samples,
 * biology quiz questions) but all of them use these primitives, so a session is reproducible from
 * (sessionId, lessonId) and there is a single place to test and fix.
 */
import { createHash } from 'crypto';

export type Rand = () => number;

/** mulberry32: small, fast, good enough for dealing cards. */
export function seededRand(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random source fixed by (sessionId, lessonId, salt): same inputs, same deal. */
export function rngFor(sessionId: string, lessonId: string, salt = ''): Rand {
  const h = createHash('sha256').update(`${sessionId}\u0000${lessonId}\u0000${salt}`).digest();
  return seededRand(h.readUInt32LE(0));
}

/** Fisher-Yates over a copy. */
export function shuffle<T>(xs: readonly T[], rand: Rand = Math.random): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A random index below n (0 when n <= 1). */
export const pickIndex = (n: number, rand: Rand = Math.random): number => (n > 1 ? Math.floor(rand() * n) : 0);

/** n distinct items, in random order. */
export const sample = <T>(xs: readonly T[], n: number, rand: Rand = Math.random): T[] => shuffle(xs, rand).slice(0, n);

/** Option ids in a fresh order. With `avoid`, the correct answer is kept off that slot, so it cannot sit in the same place twice running. */
export function dealOptions(ids: readonly string[], rand: Rand = Math.random, correct?: string, avoidSlot?: number): string[] {
  let out = shuffle(ids, rand);
  if (correct !== undefined && avoidSlot !== undefined && ids.length > 1 && out.indexOf(correct) === avoidSlot) {
    const j = (avoidSlot + 1 + Math.floor(rand() * (ids.length - 1))) % ids.length;
    [out[avoidSlot], out[j]] = [out[j], out[avoidSlot]];
  }
  return out;
}
