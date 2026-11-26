import type { OpenPackResponse, RewardCard } from '@mmaxr/schema'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { placeholderGlyph } from '../gamification/cardFace'
import { bestLines } from '../gamification/packNotice'
import { packPerks, prettyLesson, revealPlan, summarise, tierLabel } from '../gamification/rarity'
import { claimPack, RewardsError } from '../services/rewards'

const card = (id: string, rarity: RewardCard['rarity']): RewardCard => ({
  id, subject: 'chemistry', set: 'elements', rarity, title: id, subtitle: id, order: 1, data: {}, funFact: 'fact', question: null,
})
const pulled = (slot: number, rarity: RewardCard['rarity'], extra: Partial<OpenPackResponse['cards'][number]> = {}): OpenPackResponse['cards'][number] => ({
  slot, isNew: true, guaranteed: null, shardsAwarded: 0, card: card(`c${slot}`, rarity), ...extra,
})

describe('reveal pacing', () => {
  it('reveals in slot order and builds longer for rarer cards', () => {
    const plan = revealPlan([pulled(3, 'legendary'), pulled(1, 'common'), pulled(2, 'epic')])
    expect(plan.map((s) => s.slot)).toEqual([1, 2, 3])
    expect(plan.map((s) => s.burst)).toEqual([0, 2, 3])
    expect(plan[0].holdMs).toBeLessThan(plan[1].holdMs)
    expect(plan[1].holdMs).toBeLessThan(plan[2].holdMs)
    expect(plan[0].note).toBeLessThan(plan[2].note)
  })

  it('drops the waiting with reduced motion', () => {
    expect(revealPlan([pulled(1, 'legendary')], true)[0].holdMs).toBe(0)
  })
})

describe('pack summary and labels', () => {
  it('counts new cards, shards and the best pull', () => {
    const s = summarise([pulled(1, 'common'), pulled(2, 'rare', { isNew: false, shardsAwarded: 2 }), pulled(3, 'common')])
    expect(s).toMatchObject({ total: 3, newCards: 2, shards: 2, best: 'rare', byRarity: { common: 2, rare: 1, epic: 0, legendary: 0 } })
  })

  it('explains why a pack is special', () => {
    expect(tierLabel({ tier: 'mastery', week: null })).toBe('Mastery pack')
    expect(tierLabel({ tier: 'weekly', week: '2026-W48' })).toBe('Weekly rings pack')
    expect(packPerks({ tier: 'mastery', firstCompletion: true, cardCount: 4 })).toEqual(['First finish: +1 card', 'Score 90%+: Rare or better inside'])
    expect(packPerks({ tier: 'standard', firstCompletion: false, cardCount: 3 })).toEqual([])
    expect(prettyLesson('ionic-bonding')).toBe('Ionic Bonding')
  })

  it('celebrates only real records', () => {
    expect(bestLines(null)).toEqual([])
    const base = { lessonId: 'atom-builder', bestPercent: 93, previousBestPercent: 60, fastestMs: 125_000, previousFastestMs: 200_000, masteryLevel: 4, completions: 2 }
    expect(bestLines({ ...base, newBestScore: true, newFastestTime: true, levelUp: true })).toEqual([
      'New best score: 93% (was 60%)',
      'Fastest finish: 2:05 (was 3:20)',
      'Mastery level 4 reached',
    ])
    expect(bestLines({ ...base, newBestScore: false, newFastestTime: false, levelUp: false })).toEqual([])
  })
})

describe('placeholder glyph', () => {
  it('uses symbols for symbolic sets and initials for the rest', () => {
    expect(placeholderGlyph({ set: 'elements', title: 'Sodium', subtitle: 'Na' })).toBe('Na')
    expect(placeholderGlyph({ set: 'cells', title: 'Plant cell', subtitle: 'plants' })).toBe('PC')
    expect(placeholderGlyph({ set: 'nomenclature', title: "Baker's yeast", subtitle: 'Saccharomyces cerevisiae' })).toBe('BY')
  })
})

describe('claimPack', () => {
  beforeEach(() => {
    const store = new Map([['mmaxr.student.auth', JSON.stringify({ token: 't', user: { id: 'u' } })]])
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: () => undefined, removeItem: () => undefined })
  })
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status })
  const ok = { created: true, pack: { id: 'p1' }, personalBest: null }

  it('retries while the server has not seen the submit yet, then succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(reply(409, { error: 'Finish the lab', status: 'in_progress' }))
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(reply(201, ok))
    const res = await claimPack('s1', { fetchImpl, delayMs: 1 })
    expect(res.pack.id).toBe('p1')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls[0][0]).toMatch(/\/sessions\/s1\/claim$/)
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe('Bearer t')
  })

  it('stops at once for a session left early', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(409, { error: 'left early', status: 'left' }))
    await expect(claimPack('s1', { fetchImpl, delayMs: 1 })).rejects.toBeInstanceOf(RewardsError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('gives up after the last attempt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(reply(503, { error: 'down' }))
    await expect(claimPack('s1', { fetchImpl, delayMs: 1, attempts: 3 })).rejects.toMatchObject({ status: 503 })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
