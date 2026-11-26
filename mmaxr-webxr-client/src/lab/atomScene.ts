import * as THREE from 'three'
import { BENCH_Y, BenchScene, type BenchProp } from './benchScene'
import { charge, element, hasCompleteOuterShell, ionBadge, type Atom } from '../state/atomKit'

const PROTON = 0xff5a5a
const NEUTRON = 0x9aa6b8
const ELECTRON = 0x5fe1ff
const SHELL_R = [0.1, 0.155, 0.21, 0.265]
const PARTICLE_R = 0.0135

/** The lab's props: glassware from mmaxr-assets, kept to the sides of the bench. */
export const CHEM_PROPS: BenchProp[] = [
  { file: 'erlenmeyer_flask.glb', height: 0.2, x: -0.58, z: -0.18, rotY: 0.4 },
  { file: 'test_tube_rack.glb', height: 0.16, x: 0.6, z: -0.2, rotY: -0.3 },
  { file: 'graduated-cylinder.glb', height: 0.26, x: -0.78, z: -0.3 },
]

/** Points spread evenly over a ball, for packing a nucleus. */
export function nucleusLayout(n: number): THREE.Vector3[] {
  if (n <= 1) return n === 1 ? [new THREE.Vector3()] : []
  const radius = PARTICLE_R * 1.15 * Math.cbrt(n)
  const out: THREE.Vector3[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2
    const r = Math.sqrt(1 - y * y)
    const a = i * golden
    // Alternate the depth a little so the ball looks packed rather than hollow.
    const k = radius * (i % 3 === 0 ? 0.55 : 1)
    out.push(new THREE.Vector3(Math.cos(a) * r * k, y * k, Math.sin(a) * r * k))
  }
  return out
}

export interface AtomVisual {
  group: THREE.Group
  nucleus: THREE.Group
  shells: THREE.Mesh[]
  electrons: THREE.Group[]
  tag: THREE.Sprite
}

/** Particle meshes share these, so a rebuild never leaks geometry. */
const sphere = new THREE.SphereGeometry(PARTICLE_R, 20, 14)
const electronGeo = new THREE.SphereGeometry(PARTICLE_R * 0.7, 16, 12)
const mats = {
  p: new THREE.MeshStandardMaterial({ color: PROTON, roughness: 0.35, metalness: 0.05, emissive: PROTON, emissiveIntensity: 0.15 }),
  n: new THREE.MeshStandardMaterial({ color: NEUTRON, roughness: 0.45, metalness: 0.1 }),
  e: new THREE.MeshStandardMaterial({ color: ELECTRON, roughness: 0.2, emissive: ELECTRON, emissiveIntensity: 0.9 }),
}

/** Draws one atom (nucleus, shells, electrons) into `v`, replacing what was there. */
export function drawAtom(v: AtomVisual, a: Atom, opts: { shellCount?: number; highlightOuter?: boolean } = {}) {
  v.nucleus.clear()
  const kinds = [...Array(a.protons).fill('p'), ...Array(a.neutrons).fill('n')]
  // Interleave protons and neutrons so neither colour hides behind the other.
  kinds.sort((x, y) => (x === y ? 0 : x === 'p' ? -1 : 1))
  const mixed: string[] = []
  let pi = 0
  let ni = a.protons
  while (pi < a.protons || ni < kinds.length) {
    if (pi < a.protons) mixed.push(kinds[pi++])
    if (ni < kinds.length) mixed.push(kinds[ni++])
  }
  nucleusLayout(mixed.length).forEach((p, i) => {
    const m = new THREE.Mesh(sphere, mixed[i] === 'p' ? mats.p : mats.n)
    m.position.copy(p)
    m.castShadow = true
    v.nucleus.add(m)
  })
  const shellCount = Math.max(opts.shellCount ?? 0, a.shells.length)
  const outer = a.shells.length - 1
  v.shells.forEach((ring, i) => {
    ring.visible = i < shellCount
    const mat = ring.material as THREE.MeshBasicMaterial
    const complete = i === outer && hasCompleteOuterShell(a.shells)
    mat.color.set(complete ? 0x7fe6b5 : opts.highlightOuter && i === outer ? 0xffd166 : 0x8ab4ff)
    mat.opacity = i === outer ? 0.75 : 0.4
    mat.userData.base = mat.opacity
  })
  v.electrons.forEach((g, i) => {
    g.clear()
    const n = a.shells[i] ?? 0
    for (let k = 0; k < n; k++) {
      const e = new THREE.Mesh(electronGeo, mats.e)
      const ang = (k / n) * Math.PI * 2
      e.position.set(Math.cos(ang) * SHELL_R[i], 0, Math.sin(ang) * SHELL_R[i])
      e.userData.electron = { shell: i + 1, index: k }
      g.add(e)
    }
  })
}

/** Builds the empty frame of an atom: four shell rings (clickable) and their electron carriers. */
export function makeAtomVisual(pickPrefix: string): AtomVisual {
  const group = new THREE.Group()
  const nucleus = new THREE.Group()
  group.add(nucleus)
  // The shells lie tilted towards the student, so every electron stays in view.
  const plane = new THREE.Group()
  plane.rotation.x = Math.PI * 0.36
  group.add(plane)
  const shells: THREE.Mesh[] = []
  const electrons: THREE.Group[] = []
  SHELL_R.forEach((r, i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0022, 8, 96), new THREE.MeshBasicMaterial({ color: 0x8ab4ff, transparent: true, opacity: 0.4, depthWrite: false }))
    // Rings lie flat in the tilted plane, like the electrons on them.
    ring.rotation.x = Math.PI / 2
    // A fatter invisible ring makes the thin shell easy to click.
    const hit = new THREE.Mesh(new THREE.TorusGeometry(r, 0.016, 6, 48), new THREE.MeshBasicMaterial({ visible: false }))
    hit.userData.pick = `${pickPrefix}shell:${i + 1}`
    ring.add(hit)
    const carrier = new THREE.Group()
    plane.add(ring, carrier)
    shells.push(ring)
    electrons.push(carrier)
  })
  const tag = new THREE.Sprite()
  group.add(tag)
  return { group, nucleus, shells, electrons, tag }
}

export interface AtomSceneEvents {
  onShell(shell: number): void
}

/** Atom Builder on the bench: one atom over a stand, built particle by particle. */
export class AtomScene extends BenchScene {
  private atom: AtomVisual
  private atomState: Atom | null = null
  private glow = 0

  constructor(canvas: HTMLCanvasElement, private readonly events: AtomSceneEvents) {
    super(canvas, new THREE.Vector3(0, BENCH_Y + 0.24, 0.05), 1.9)
    this.stand(0, 0.05)
    this.atom = makeAtomVisual('')
    this.atom.group.position.set(0, BENCH_Y + 0.3, 0.05)
    this.scene.add(this.atom.group)
    this.pickables.push(this.atom.group)
    this.atom.tag.position.set(0, 0.36, 0)
  }

  show(a: Atom) {
    const before = this.atomState
    this.atomState = { ...a, shells: [...a.shells] }
    drawAtom(this.atom, a, { shellCount: Math.min(4, a.shells.length + 1) })
    const el = element(a.protons)
    const ion = ionBadge(a)
    const text = `${ion ? ion.label : el?.symbol ?? '?'}  ·  ${el?.name ?? ''}`
    this.setLabel(this.atom.tag, text, { wide: true, bg: charge(a) === 0 ? 'rgba(20,24,32,0.85)' : charge(a) > 0 ? 'rgba(120,40,40,0.9)' : 'rgba(30,70,130,0.9)' })
    this.atom.tag.scale.multiplyScalar(1.4)
    if (before && hasCompleteOuterShell(a.shells) && !hasCompleteOuterShell(before.shells)) this.glow = 1
  }

  /** A short bright pulse, for a met mission. */
  celebrate() {
    this.glow = 1.4
  }

  protected onPick(id: string) {
    const m = /^shell:(\d)$/.exec(id)
    if (m) this.events.onShell(Number(m[1]))
  }

  protected tick(dt: number, time: number) {
    this.atom.electrons.forEach((g, i) => (g.rotation.y = time * (0.55 - i * 0.1)))
    this.atom.nucleus.rotation.y = time * 0.25
    this.atom.group.position.y = BENCH_Y + 0.3 + Math.sin(time * 1.2) * 0.006
    this.glow = Math.max(0, this.glow - dt * 0.9)
    mats.e.emissiveIntensity = 0.9 + this.glow * 1.6
    const hover = this.hovered
    this.atom.shells.forEach((ring, i) => {
      if (!ring.visible) return
      const mat = ring.material as THREE.MeshBasicMaterial
      mat.opacity = hover === `shell:${i + 1}` ? 1 : (mat.userData.base as number | undefined) ?? 0.4
    })
  }
}
