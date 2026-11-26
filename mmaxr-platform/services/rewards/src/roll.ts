import crypto from 'crypto';
import { CARDS, RARITIES, RARITY_RANK, type Card, type Rarity, type Subject } from './catalog';

/** A number in [0, 1). Production uses the OS's secure generator; tests pass a seeded one. */
export type Rng = () => number;
export const secureRng: Rng = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

export const CARDS_PER_PACK = 3;
export const BASE_ODDS: Record<Rarity, number> = { common: 0.7, rare: 0.22, epic: 0.07, legendary: 0.01 };
/** A score at or above this guarantees at least one Rare or better. */
export const MASTERY_GUARANTEE_PERCENT = 90;
/** Every Nth pack without an Epic or Legendary is guaranteed one. */
export const PITY_EVERY = 10;
/** Weight multipliers within a rarity: cards tied to the lesson just finished, and cards from the same subject. */
export const LESSON_WEIGHT = 3;
export const SUBJECT_WEIGHT = 2;
export const SHARDS_FOR_DUPLICATE: Record<Rarity, number> = { common: 1, rare: 2, epic: 5, legendary: 10 };
export const FOIL_COST: Record<Rarity, number> = { common: 5, rare: 10, epic: 20, legendary: 40 };

/** Which subject each lesson belongs to, so its packs lean towards that subject. */
export const LESSON_SUBJECT: Record<string, Subject> = {
  'atom-builder': 'chemistry', 'chemistry-101': 'chemistry', 'ionic-bonding': 'chemistry', 'matter-properties': 'chemistry', 'metals-101': 'chemistry',
  'biology-101': 'biology', 'biology-respiratory': 'biology', 'cell-explorer': 'biology',
  'physics-101': 'physics', 'physics-electricity': 'physics', 'physics-fundamentals': 'physics', 'physics-light': 'physics',
  'physics-magnetism': 'physics', 'physics-motion': 'physics', 'physics-sound': 'physics', 'simple-machines': 'physics',
};

export interface RollInput {
  /** The lesson the pack was earned in, or null for a weekly ring bonus. */
  lessonId: string | null;
  scorePercent: number | null;
  /** True the first time this student completes this lesson: one extra card. */
  firstCompletion: boolean;
  /** Packs opened since the last Epic-or-better, before this one. */
  packsSinceEpic: number;
}

export interface RolledCard {
  slot: number;
  card: Card;
  /** Why the card's rarity was forced, if it was. */
  guaranteed: 'mastery' | 'pity' | null;
}

export interface RollResult {
  cards: RolledCard[];
  /** The pity counter to store after this pack. */
  packsSinceEpic: number;
  tier: 'standard' | 'mastery';
}

function rollRarity(rng: Rng): Rarity {
  let r = rng();
  for (const rarity of RARITIES) {
    r -= BASE_ODDS[rarity];
    if (r < 0) return rarity;
  }
  return 'common';
}

/** Draw a rarity at or above `min`, keeping the base odds' proportions among the allowed rarities. */
function rollRarityAtLeast(min: Rarity, rng: Rng): Rarity {
  const allowed = RARITIES.filter((r) => RARITY_RANK[r] >= RARITY_RANK[min]);
  const total = allowed.reduce((s, r) => s + BASE_ODDS[r], 0);
  let r = rng() * total;
  for (const rarity of allowed) {
    r -= BASE_ODDS[rarity];
    if (r < 0) return rarity;
  }
  return allowed[allowed.length - 1];
}

export function weightOf(card: Card, lessonId: string | null): number {
  if (!lessonId) return 1;
  let w = 1;
  if (card.lessons.includes(lessonId)) w *= LESSON_WEIGHT;
  if (LESSON_SUBJECT[lessonId] === card.subject) w *= SUBJECT_WEIGHT;
  return w;
}

function pickCard(rarity: Rarity, lessonId: string | null, exclude: Set<string>, rng: Rng, pool: Card[]): Card {
  const candidates = pool.filter((c) => c.rarity === rarity && !exclude.has(c.id));
  const total = candidates.reduce((s, c) => s + weightOf(c, lessonId), 0);
  let r = rng() * total;
  for (const c of candidates) {
    r -= weightOf(c, lessonId);
    if (r < 0) return c;
  }
  return candidates[candidates.length - 1];
}

/**
 * Roll the cards for one pack. Guarantees are applied by forcing the rarity of a random slot, so a guaranteed card
 * can land anywhere in the reveal order. No two cards in one pack are the same.
 */
export function rollPack(input: RollInput, rng: Rng = secureRng, pool: Card[] = CARDS): RollResult {
  const size = CARDS_PER_PACK + (input.firstCompletion ? 1 : 0);
  const rarities: { rarity: Rarity; guaranteed: RolledCard['guaranteed'] }[] = Array.from({ length: size }, () => ({ rarity: rollRarity(rng), guaranteed: null }));

  const mastery = input.scorePercent !== null && input.scorePercent >= MASTERY_GUARANTEE_PERCENT;
  if (mastery && !rarities.some((r) => RARITY_RANK[r.rarity] >= RARITY_RANK.rare)) {
    const slot = Math.floor(rng() * size);
    rarities[slot] = { rarity: rollRarityAtLeast('rare', rng), guaranteed: 'mastery' };
  }
  const pityDue = input.packsSinceEpic + 1 >= PITY_EVERY;
  if (pityDue && !rarities.some((r) => RARITY_RANK[r.rarity] >= RARITY_RANK.epic)) {
    // Prefer replacing a slot that was not already a mastery guarantee.
    const open = rarities.map((r, i) => (r.guaranteed ? -1 : i)).filter((i) => i >= 0);
    const slot = open.length ? open[Math.floor(rng() * open.length)] : Math.floor(rng() * size);
    rarities[slot] = { rarity: rollRarityAtLeast('epic', rng), guaranteed: 'pity' };
  }

  const taken = new Set<string>();
  const cards = rarities.map(({ rarity, guaranteed }, i) => {
    const card = pickCard(rarity, input.lessonId, taken, rng, pool);
    taken.add(card.id);
    return { slot: i + 1, card, guaranteed };
  });
  const gotEpic = cards.some((c) => RARITY_RANK[c.card.rarity] >= RARITY_RANK.epic);
  return { cards, packsSinceEpic: gotEpic ? 0 : input.packsSinceEpic + 1, tier: mastery ? 'mastery' : 'standard' };
}

/** Mastery level 1-5 for one lesson, from the student's best score there. */
export function masteryLevel(bestPercent: number | null): number {
  if (bestPercent === null) return 1;
  if (bestPercent >= 95) return 5;
  if (bestPercent >= 85) return 4;
  if (bestPercent >= 70) return 3;
  if (bestPercent >= 50) return 2;
  return 1;
}
