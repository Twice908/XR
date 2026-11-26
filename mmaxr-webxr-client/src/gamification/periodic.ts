/**
 * Where an element sits in the periodic table grid: 18 columns, 7 periods, and the lanthanides and actinides in
 * two rows of their own underneath (rows 9 and 10, after a spacer row), starting under group 3.
 */
export function elementPosition(z: number): { row: number; col: number } {
  if (z >= 57 && z <= 71) return { row: 9, col: z - 57 + 3 }
  if (z >= 89 && z <= 103) return { row: 10, col: z - 89 + 3 }
  const period = z <= 2 ? 1 : z <= 10 ? 2 : z <= 18 ? 3 : z <= 36 ? 4 : z <= 54 ? 5 : z <= 86 ? 6 : 7
  let col: number
  if (z === 1) col = 1
  else if (z === 2) col = 18
  else if (z <= 10) col = z <= 4 ? z - 2 : z + 8
  else if (z <= 18) col = z <= 12 ? z - 10 : z
  else if (z <= 36) col = z - 18
  else if (z <= 54) col = z - 36
  else if (z <= 56) col = z - 54
  else if (z <= 86) col = z - 68
  else if (z <= 88) col = z - 86
  else col = z - 100
  return { row: period, col }
}

/** Foil costs in shards, as the rewards service charges them. */
export const FOIL_COST = { common: 5, rare: 10, epic: 20, legendary: 40 } as const
