/** Colour vocabulary shared by the lesson contract, the prediction dialog, the notebook and the 3D liquid. */

export interface Swatch {
  name: string
  hex: number
  opacity: number
}

export const COLOR_WORDS: Record<string, Swatch> = {
  colorless: { name: 'Colorless', hex: 0xffffff, opacity: 0.12 },
  red: { name: 'Red', hex: 0xe11d48, opacity: 0.88 },
  pink: { name: 'Pink', hex: 0xf472b6, opacity: 0.88 },
  orange: { name: 'Orange', hex: 0xf97316, opacity: 0.88 },
  yellow: { name: 'Yellow', hex: 0xfacc15, opacity: 0.88 },
  green: { name: 'Green', hex: 0x22c55e, opacity: 0.88 },
  blue: { name: 'Blue', hex: 0x2563eb, opacity: 0.88 },
  violet: { name: 'Violet', hex: 0x8b5cf6, opacity: 0.9 },
  purple: { name: 'Purple', hex: 0x9333ea, opacity: 0.9 },
  brown: { name: 'Brown', hex: 0x92400e, opacity: 0.9 },
}

/** Backend names can be compound: "Red / Pink", "Reddish-Brown", "Orange-Red". Reduce to one word. */
export function baseColorName(name: string): string {
  const first = (name ?? '').split('/')[0].trim().toLowerCase()
  if (first === 'clear' || first === 'colourless') return 'colorless'
  const parts = first.split(/[-\s]+/).filter(Boolean)
  const last = (parts[parts.length - 1] ?? '').replace(/ish$/, '')
  return last === 'clear' ? 'colorless' : last
}

export function swatchFor(name: string): Swatch {
  return COLOR_WORDS[baseColorName(name)] ?? { name, hex: 0xa1a1aa, opacity: 0.85 }
}

export function cssColor(name: string): string {
  const hex = swatchFor(name).hex
  return `#${hex.toString(16).padStart(6, '0')}`
}

/** Display name of a colour as the lesson writes it, kept for the data table and telemetry. */
export function sameColor(a: string, b: string): boolean {
  return baseColorName(a) === baseColorName(b)
}

/** Universal pH paper: pH -> colour. */
export function phPaperColor(ph: number): string {
  if (ph <= 2) return 'Red'
  if (ph <= 4) return 'Orange'
  if (ph <= 6) return 'Yellow'
  if (ph <= 7) return 'Green'
  if (ph <= 10) return 'Blue'
  return 'Purple'
}

export const PH_PAPER_SCALE: { range: string; color: string; min: number; max: number }[] = [
  { range: '0 – 2', color: 'Red', min: 0, max: 2 },
  { range: '3 – 4', color: 'Orange', min: 3, max: 4 },
  { range: '5 – 6', color: 'Yellow', min: 5, max: 6 },
  { range: '7', color: 'Green', min: 7, max: 7 },
  { range: '8 – 10', color: 'Blue', min: 8, max: 10 },
  { range: '11 – 14', color: 'Purple', min: 11, max: 14 },
]
