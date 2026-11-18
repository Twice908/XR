/**
 * Backend color names can be compound ("Red / Pink", "Reddish-Brown", "Orange-Red").
 * Reduce to one base color word: first alternative before "/", last part of a hyphenated blend.
 */
export function baseColorName(name: string): string {
  const first = (name ?? '').split('/')[0].trim().toLowerCase()
  const parts = first.split(/[-\s]+/).filter(Boolean)
  const last = parts[parts.length - 1] ?? ''
  return last.replace(/ish$/, '')
}

/** Universal pH paper: pH -> displayed color name. */
export function phPaperColor(ph: number): string {
  if (ph <= 2) return 'Red'
  if (ph <= 4) return 'Orange'
  if (ph <= 6) return 'Yellow'
  if (ph <= 7) return 'Green'
  if (ph <= 10) return 'Blue'
  return 'Purple'
}
