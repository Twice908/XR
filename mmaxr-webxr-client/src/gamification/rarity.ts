import type { CardRarity, CardSetId, OpenPackResponse, RewardPack } from '@mmaxr/schema'

export const RARITY_LABEL: Record<CardRarity, string> = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary' }
export const RARITY_RANK: Record<CardRarity, number> = { common: 0, rare: 1, epic: 2, legendary: 3 }

export const SET_LABEL: Record<CardSetId, string> = {
  elements: 'Elements',
  compounds: 'Compounds',
  'fundamental-quantities': 'Fundamental Quantities',
  'derived-quantities': 'Derived Quantities',
  symbols: 'Symbols',
  powers: 'Powers',
  formulas: 'Formulas',
  cells: 'Cells',
  systems: 'Systems',
  nomenclature: 'Nomenclature',
}

export function tierLabel(pack: Pick<RewardPack, 'tier' | 'week'>): string {
  if (pack.tier === 'weekly') return 'Weekly rings pack'
  if (pack.tier === 'mastery') return 'Mastery pack'
  return 'Lab pack'
}

/** Short reasons this pack is special, shown on the notice and the sealed pack. */
export function packPerks(pack: Pick<RewardPack, 'tier' | 'firstCompletion' | 'cardCount'>): string[] {
  const perks: string[] = []
  if (pack.firstCompletion) perks.push('First finish: +1 card')
  if (pack.tier === 'mastery') perks.push('Score 90%+: Rare or better inside')
  if (pack.tier === 'weekly') perks.push('All three rings closed')
  return perks
}

export interface RevealStep {
  slot: number
  rarity: CardRarity
  /** How long the face-down card trembles before it flips: rarer cards build more anticipation. */
  holdMs: number
  /** Celebration strength, 0 (none) to 3 (full burst). */
  burst: 0 | 1 | 2 | 3
  /** MIDI note for the reveal sound: rarer cards ring higher. */
  note: number
}

const HOLD: Record<CardRarity, number> = { common: 250, rare: 550, epic: 900, legendary: 1400 }
const NOTE: Record<CardRarity, number> = { common: 67, rare: 72, epic: 76, legendary: 79 }

/**
 * The order and pacing of a pack reveal: one card at a time, in slot order. The rarest card is kept for the
 * moment it lands in its slot, so every flip is its own small surprise. Reduced motion drops the waiting.
 */
export function revealPlan(cards: OpenPackResponse['cards'], reducedMotion = false): RevealStep[] {
  return [...cards]
    .sort((a, b) => a.slot - b.slot)
    .map((c) => ({
      slot: c.slot,
      rarity: c.card.rarity,
      holdMs: reducedMotion ? 0 : HOLD[c.card.rarity],
      burst: RARITY_RANK[c.card.rarity] as RevealStep['burst'],
      note: NOTE[c.card.rarity],
    }))
}

export interface PackSummary {
  total: number
  newCards: number
  shards: number
  best: CardRarity
  byRarity: Record<CardRarity, number>
}

export function summarise(cards: OpenPackResponse['cards']): PackSummary {
  const byRarity: Record<CardRarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 }
  let best: CardRarity = 'common'
  for (const c of cards) {
    byRarity[c.card.rarity]++
    if (RARITY_RANK[c.card.rarity] > RARITY_RANK[best]) best = c.card.rarity
  }
  return {
    total: cards.length,
    newCards: cards.filter((c) => c.isNew).length,
    shards: cards.reduce((s, c) => s + c.shardsAwarded, 0),
    best,
    byRarity,
  }
}

/** "atom-builder" → "Atom Builder", used until the lesson list has loaded. */
export const prettyLesson = (id: string) => id.split(/[-_]/).map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ')
