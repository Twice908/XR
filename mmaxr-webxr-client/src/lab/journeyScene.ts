import type * as THREE from 'three'

/** What the guided-journey page needs from a 3D scene, so each lesson can bring its own. */
export interface JourneyScene {
  readonly head: THREE.Vector3
  readonly hand: THREE.Vector3
  load(): Promise<void>
  start(): void
  /** Fly to checkpoint i (instantly when asked). */
  arrive(i: number, instant?: boolean): Promise<void>
  /** Play what really happens at a stop. Lasts at least `minMs`. */
  playReveal(checkpointId: string, labels: string[], minMs?: number): Promise<void>
  /** Zoom out to see the whole model (true), or go back to the stop's own view (false). */
  overview(on: boolean): void
  setInsets(i: { left: number; right: number; top: number; bottom: number }): void
  /** The final check: place the student back at the start. */
  enterFinal?(): Promise<void> | void
  dispose(): void
}
