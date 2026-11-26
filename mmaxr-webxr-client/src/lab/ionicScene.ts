import * as THREE from 'three'
import { BENCH_Y, BenchScene } from './benchScene'
import { drawAtom, makeAtomVisual, type AtomVisual } from './atomScene'
import { charge, formatIon, type IonicState } from '../state/atomKit'

const SPREAD = 0.3
const LIFT = 0.3

export interface IonicSceneEvents {
  /** The student clicked an atom (or one of its shells). */
  onAtom(id: 'na' | 'cl'): void
}

/** Ionic Bonding on the bench: sodium and chlorine over two stands, an electron that moves, and the join. */
export class IonicScene extends BenchScene {
  private atoms: Record<'na' | 'cl', AtomVisual>
  private selected: 'na' | 'cl' | null = null
  private bondLabel: THREE.Sprite
  private home: Record<'na' | 'cl', number> = { na: -SPREAD, cl: SPREAD }
  private bonded = false
  private pulse = 0

  constructor(canvas: HTMLCanvasElement, private readonly events: IonicSceneEvents) {
    super(canvas, new THREE.Vector3(0, BENCH_Y + LIFT - 0.02, 0.05), 1.8)
    this.stand(-SPREAD, 0.05)
    this.stand(SPREAD, 0.05)
    const make = (id: 'na' | 'cl') => {
      const v = makeAtomVisual(`${id}:`)
      v.group.position.set(this.home[id], BENCH_Y + LIFT, 0.05)
      v.group.userData.pick = `${id}:atom`
      v.tag.position.set(0, 0.33, 0)
      this.scene.add(v.group)
      this.pickables.push(v.group)
      return v
    }
    this.atoms = { na: make('na'), cl: make('cl') }
    this.bondLabel = this.label('NaCl', { wide: true, bg: 'rgba(30,110,80,0.9)' })
    // Just under the joined ions: clear of the top bar above and the captions below.
    this.bondLabel.position.set(0, BENCH_Y + LIFT - 0.2, 0.2)
    this.bondLabel.visible = false
    this.scene.add(this.bondLabel)
  }

  show(s: IonicState, opts: { highlightGiver?: boolean } = {}) {
    for (const a of s.atoms) {
      const v = this.atoms[a.id]
      drawAtom(v, a.atom, { highlightOuter: opts.highlightGiver && a.id === 'na' && !s.bonded })
      const c = charge(a.atom)
      this.setLabel(v.tag, `${formatIon(a.symbol, c)}  ·  ${a.atom.shells.join(',')}`, { wide: true, bg: c === 0 ? 'rgba(20,24,32,0.85)' : c > 0 ? 'rgba(120,40,40,0.9)' : 'rgba(30,70,130,0.9)' })
      v.tag.scale.multiplyScalar(1.3)
    }
    if (s.bonded !== this.bonded) {
      this.bonded = s.bonded
      void this.slideTogether(s.bonded)
    }
  }

  select(id: 'na' | 'cl' | null) {
    this.selected = id
  }

  /** An electron flies from the giver's outer shell to the taker's, in an arc over the bench. */
  async flyElectron(from: 'na' | 'cl', to: 'na' | 'cl', fromShell: number, toShell: number) {
    const start = this.shellPoint(from, fromShell, 0)
    const end = this.shellPoint(to, toShell, Math.PI)
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.011, 16, 12), new THREE.MeshStandardMaterial({ color: 0x5fe1ff, emissive: 0x5fe1ff, emissiveIntensity: 2 }))
    e.position.copy(start)
    this.scene.add(e)
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.16, 0.06))
    const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
    await this.animate(0.9, (t) => e.position.copy(curve.getPoint(t)))
    this.scene.remove(e)
    e.geometry.dispose()
    ;(e.material as THREE.Material).dispose()
    this.pulse = 1
  }

  private shellPoint(id: 'na' | 'cl', shell: number, angle: number) {
    const v = this.atoms[id]
    const ring = v.shells[Math.max(0, shell - 1)]
    const p = new THREE.Vector3(Math.cos(angle) * (ring.geometry as THREE.TorusGeometry).parameters.radius, 0, Math.sin(angle) * (ring.geometry as THREE.TorusGeometry).parameters.radius)
    return ring.parent!.localToWorld(p)
  }

  private async slideTogether(on: boolean) {
    const from = { na: this.atoms.na.group.position.x, cl: this.atoms.cl.group.position.x }
    const to = on ? { na: -0.15, cl: 0.15 } : this.home
    this.bondLabel.visible = on
    await this.animate(1.1, (t) => {
      this.atoms.na.group.position.x = from.na + (to.na - from.na) * t
      this.atoms.cl.group.position.x = from.cl + (to.cl - from.cl) * t
    })
    if (on) this.pulse = 1.4
  }

  protected onPick(id: string) {
    const who = id.slice(0, 2)
    if (who === 'na' || who === 'cl') this.events.onAtom(who)
  }

  protected tick(dt: number, time: number) {
    this.pulse = Math.max(0, this.pulse - dt * 0.9)
    for (const id of ['na', 'cl'] as const) {
      const v = this.atoms[id]
      v.electrons.forEach((g, i) => (g.rotation.y = time * (0.5 - i * 0.09) + (id === 'cl' ? 1 : 0)))
      v.nucleus.rotation.y = time * 0.25
      v.group.position.y = BENCH_Y + LIFT + Math.sin(time * 1.2 + (id === 'cl' ? 1.3 : 0)) * 0.006
      const chosen = this.selected === id
      const hovered = this.hovered?.startsWith(id) ?? false
      // Two atoms share the bench, so each is drawn a little smaller than the Atom Builder's one.
      const scale = 0.78 * (1 + (chosen ? 0.06 : hovered ? 0.03 : 0) + this.pulse * 0.03)
      v.group.scale.lerp(new THREE.Vector3(scale, scale, scale), Math.min(1, dt * 10))
    }
    this.bondLabel.material.opacity = this.bonded ? 0.85 + Math.sin(time * 2) * 0.15 : 0
  }
}
