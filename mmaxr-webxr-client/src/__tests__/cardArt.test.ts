import { describe, expect, it } from 'vitest'
import { cardArt } from '../gamification/cardFace'

describe('cardArt', () => {
  it('uses only the art address the rewards API sent', () => {
    const art = { front: '/cards/a/0123456789abcdef0123456789abcdef-front.webp', frontSmall: '/cards/a/0123456789abcdef0123456789abcdef-front-sm.webp', back: '/cards/a/0123456789abcdef0123456789abcdef-back.webp' }
    expect(cardArt({ art })).toEqual(art)
  })

  it('never builds an address itself, so cards without one show the placeholder', () => {
    expect(cardArt({ art: null })).toBeNull()
    expect(cardArt({})).toBeNull()
  })
})
