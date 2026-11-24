import { describe, expect, it } from 'vitest'
import { baseColorName, phPaperColor, sameColor } from '../services/colors'

describe('colors', () => {
  it('reduces compound lesson colours to one word', () => {
    expect(baseColorName('Red / Pink')).toBe('red')
    expect(baseColorName('Reddish-Brown')).toBe('brown')
    expect(baseColorName('Orange-Red')).toBe('red')
    expect(baseColorName('Green / Yellow')).toBe('green')
    expect(baseColorName('Colorless')).toBe('colorless')
  })
  it('compares colours by base word', () => {
    expect(sameColor('Red / Pink', 'red')).toBe(true)
    expect(sameColor('Blue', 'Violet')).toBe(false)
  })
  it('maps pH to paper colours', () => {
    expect(phPaperColor(1)).toBe('Red')
    expect(phPaperColor(7)).toBe('Green')
    expect(phPaperColor(14)).toBe('Purple')
  })
})
