import { describe, expect, it } from 'vitest'
import { cardArt } from '../gamification/cardFace'

describe('cardArt', () => {
  it('finds element art by symbol', () => {
    expect(cardArt({ id: 'chem-el-Au' })?.front).toMatch(/cards\/elements\/Au-front\.webp$/)
  })
  it('finds physics art for base and derived quantities', () => {
    expect(cardArt({ id: 'phys-base-length' })?.back).toMatch(/cards\/physics\/length-back\.webp$/)
    expect(cardArt({ id: 'phys-der-power-of-lens' })?.frontSmall).toMatch(/cards\/physics\/power-of-lens-front-sm\.webp$/)
  })
  it('has no art for cards not drawn yet', () => {
    expect(cardArt({ id: 'phys-der-unknown' })).toBeNull()
    expect(cardArt({ id: 'chem-cmp-water' })).toBeNull()
  })
})
