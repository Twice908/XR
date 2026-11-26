/*
 * The chemistry rules of MMAXR's Atom Builder and Ionic Bonding (its kit-chemistry), ported for XR's bench labs:
 * elements 1-20, Bohr-Bury shell filling with the same refusal messages, ions, the electron transfer and the join,
 * and the sounds each change makes. Pure: the server re-checks every build, so these only drive the bench.
 */

export interface Atom {
  protons: number
  neutrons: number
  shells: number[]
}

export const ELEMENTS: readonly { symbol: string; name: string }[] = [
  { symbol: 'H', name: 'Hydrogen' }, { symbol: 'He', name: 'Helium' }, { symbol: 'Li', name: 'Lithium' }, { symbol: 'Be', name: 'Beryllium' },
  { symbol: 'B', name: 'Boron' }, { symbol: 'C', name: 'Carbon' }, { symbol: 'N', name: 'Nitrogen' }, { symbol: 'O', name: 'Oxygen' },
  { symbol: 'F', name: 'Fluorine' }, { symbol: 'Ne', name: 'Neon' }, { symbol: 'Na', name: 'Sodium' }, { symbol: 'Mg', name: 'Magnesium' },
  { symbol: 'Al', name: 'Aluminium' }, { symbol: 'Si', name: 'Silicon' }, { symbol: 'P', name: 'Phosphorus' }, { symbol: 'S', name: 'Sulfur' },
  { symbol: 'Cl', name: 'Chlorine' }, { symbol: 'Ar', name: 'Argon' }, { symbol: 'K', name: 'Potassium' }, { symbol: 'Ca', name: 'Calcium' },
]
export const MAX_Z = 20
const MAX_ELECTRONS = 20

export const element = (protons: number) => ELEMENTS[protons - 1]
export const electronCount = (shells: readonly number[]) => shells.reduce((a, b) => a + b, 0)
export const charge = (a: Atom) => a.protons - electronCount(a.shells)
export const massNumber = (a: Atom) => a.protons + a.neutrons
/** Electrons a shell (1-based) holds at this level: 2, 8, 8, 2. */
export const shellLimit = (shell: number) => Math.min(2 * shell * shell, 8)

export function hasCompleteOuterShell(shells: readonly number[]): boolean {
  let outer = -1
  shells.forEach((n, i) => {
    if (n > 0) outer = i
  })
  return outer >= 0 && shells[outer] === (outer === 0 ? 2 : 8)
}
export type OuterShell = 'empty' | 'reactive' | 'complete'
export const outerShellState = (shells: readonly number[]): OuterShell => (electronCount(shells) === 0 ? 'empty' : hasCompleteOuterShell(shells) ? 'complete' : 'reactive')

const SUPER: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
/** "Na⁺", "Cl⁻", "Mg²⁺" with a plain reason, or null for a neutral atom. */
export function ionBadge(a: Atom): { label: string; detail: string } | null {
  const c = charge(a)
  const el = element(a.protons)
  if (!el || c === 0) return null
  const size = Math.abs(c)
  const digits = size === 1 ? '' : [...String(size)].map((d) => SUPER[d] ?? d).join('')
  const e = size === 1 ? '1 electron' : `${size} electrons`
  return { label: `${el.symbol}${digits}${c > 0 ? '⁺' : '⁻'}`, detail: c > 0 ? `Positive ion: ${e} lost` : `Negative ion: ${e} gained` }
}
/** "Na", "Na+", "Cl-" as students write it. */
export const formatIon = (symbol: string, c: number) => (c === 0 ? symbol : `${symbol}${Math.abs(c) === 1 ? '' : Math.abs(c)}${c > 0 ? '+' : '-'}`)

/** Can an electron go on this shell? Null when it can, else MMAXR's reason. */
export function placementProblem(shells: readonly number[], shell: number): string | null {
  if (!Number.isInteger(shell) || shell < 1 || shell > 4) return 'Choose a shell from 1 to 4.'
  for (let inner = 1; inner < shell; inner++) {
    if ((shells[inner - 1] ?? 0) < shellLimit(inner)) return `Fill shell ${inner} before adding an electron to shell ${shell}.`
  }
  if ((shells[shell - 1] ?? 0) >= shellLimit(shell)) return shell === 3 ? 'For elements 1-20, shell 3 holds 8 before shell 4 is used.' : `Shell ${shell} holds at most ${shellLimit(shell)} electrons.`
  if (electronCount(shells) >= MAX_ELECTRONS) return 'This kit supports up to 20 electrons.'
  return null
}
/** Can an electron leave this shell? Null when it can, else MMAXR's reason. */
export function removalProblem(shells: readonly number[], shell: number): string | null {
  if (!Number.isInteger(shell) || shell < 1 || shell > 4) return 'Choose a shell from 1 to 4.'
  if ((shells[shell - 1] ?? 0) < 1) return 'That shell has no electron to remove.'
  if (shells.slice(shell).some((n) => n > 0)) return 'Remove electrons from the outer shell first.'
  return null
}
export function addElectron(shells: readonly number[], shell: number): number[] {
  const out = [...shells]
  while (out.length < shell) out.push(0)
  out[shell - 1] += 1
  return out
}
export function removeElectron(shells: readonly number[], shell: number): number[] {
  const out = [...shells]
  out[shell - 1] -= 1
  while (out.length && out[out.length - 1] === 0) out.pop()
  return out
}

/* ---------------- ionic bonding: sodium and chlorine ---------------- */

export interface IonicAtom {
  id: 'na' | 'cl'
  symbol: 'Na' | 'Cl'
  name: string
  role: 'metal' | 'non-metal'
  atom: Atom
}
export interface IonicState {
  atoms: [IonicAtom, IonicAtom]
  bonded: boolean
}
export const freshIonic = (): IonicState => ({
  atoms: [
    { id: 'na', symbol: 'Na', name: 'Sodium', role: 'metal', atom: { protons: 11, neutrons: 12, shells: [2, 8, 1] } },
    { id: 'cl', symbol: 'Cl', name: 'Chlorine', role: 'non-metal', atom: { protons: 17, neutrons: 18, shells: [2, 8, 7] } },
  ],
  bonded: false,
})

const particleName = (a: IonicAtom) => `${a.name.toLowerCase()} ${charge(a.atom) === 0 ? 'atom' : 'ion'}`
const completePhrase = (shells: readonly number[]) => (shells.length === 1 ? 'a complete outer shell' : 'a complete outer shell (an octet)')
const electrons = (n: number) => (n === 1 ? '1 electron' : `${n} electrons`)

/** Move one outer electron from `fromId` to `toId`, or say why not (MMAXR's wording). */
export function transfer(s: IonicState, fromId: string, toId: string): { state: IonicState } | { problem: string } {
  if (s.bonded) return { problem: 'The ions are already joined. Reset to try again.' }
  const donor = s.atoms.find((a) => a.id === fromId)
  const acceptor = s.atoms.find((a) => a.id === toId)
  if (!donor || !acceptor) return { problem: 'Move an electron from one atom in the model to another.' }
  if (donor.id === acceptor.id) return { problem: 'Move the electron to a different atom.' }
  if (donor.role !== 'metal') return { problem: `${donor.name} is a non-metal. It takes electrons to complete its outer shell, so it does not give them away.` }
  if (acceptor.role !== 'non-metal') return { problem: `${acceptor.name} is a metal. Metals give electrons away, so move the electron to a non-metal atom.` }
  if (hasCompleteOuterShell(donor.atom.shells)) return { problem: `This ${particleName(donor)} already has ${completePhrase(donor.atom.shells)}. It has no outer electron left to give.` }
  if (hasCompleteOuterShell(acceptor.atom.shells)) return { problem: `This ${particleName(acceptor)} already has ${completePhrase(acceptor.atom.shells)}. It cannot take another electron.` }
  const from = removalProblem(donor.atom.shells, donor.atom.shells.length)
  if (from) return { problem: from }
  const to = placementProblem(acceptor.atom.shells, acceptor.atom.shells.length)
  if (to) return { problem: to }
  const next = (a: IonicAtom): IonicAtom =>
    a.id === donor.id ? { ...a, atom: { ...a.atom, shells: removeElectron(a.atom.shells, a.atom.shells.length) } } : a.id === acceptor.id ? { ...a, atom: { ...a.atom, shells: addElectron(a.atom.shells, a.atom.shells.length) } } : a
  return { state: { ...s, atoms: [next(s.atoms[0]), next(s.atoms[1])] } }
}

/** Join the ions, or say why they are not ready (MMAXR's wording). */
export function join(s: IonicState): { state: IonicState } | { problem: string } {
  if (s.bonded) return { problem: 'The ions are already joined.' }
  for (const a of s.atoms) {
    if (hasCompleteOuterShell(a.atom.shells)) continue
    const outer = a.atom.shells[a.atom.shells.length - 1] ?? 0
    if (a.role === 'metal') return { problem: `${a.name} still has ${electrons(outer)} in its outer shell to give away, so it is not an ion yet.` }
    const cap = a.atom.shells.length === 1 ? 2 : 8
    return { problem: `${a.name} needs ${electrons(cap - outer)} more to complete its outer shell, so it is not an ion yet.` }
  }
  if (s.atoms.reduce((sum, a) => sum + charge(a.atom), 0) !== 0) return { problem: 'The positive and negative charges do not balance yet.' }
  return { state: { ...s, bonded: true } }
}

/* ---------------- sounds (MMAXR's atom sounds, note for note) ---------------- */

/** Each shell has its own home note (MIDI): K, L, M, N climb from G4 upwards. */
export const SHELL_ROOTS = [67, 74, 79, 86]
export const SHELL_STEPS = [0, 2, 4, 6, 7, 9, 11, 12]
/** The chord that rings out when the outer shell becomes complete. */
export const COMPLETE_CHORD = [67, 71, 74, 78, 81]
export const PROTON_NOTE = 69
export const NEUTRON_NOTE = 64
/** Notes of the mission-complete chord and the whole-lesson chord. */
export const MISSION_CHORD = [79, 83, 86, 90, 93]
export const LESSON_CHORD = [67, 74, 79, 83, 86, 91, 95]

/** The note the k-th electron (from 0) makes as it lands in a shell (from 1). */
export const electronNote = (shell: number, index: number) => (SHELL_ROOTS[Math.min(SHELL_ROOTS.length, Math.max(1, shell)) - 1] ?? 67) + (SHELL_STEPS[index % SHELL_STEPS.length] ?? 0)
