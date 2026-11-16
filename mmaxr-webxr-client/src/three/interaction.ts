import * as THREE from 'three'
import type { ViewRig } from './viewRig'

export interface InteractionDeps {
  viewRig: ViewRig
  onHit: (object: THREE.Object3D, point: THREE.Vector3) => void
}

/**
 * Interaction logic ONLY knows:  (a) view rig ray  (b) scene graph.
 * It does NOT know about the renderer, XR session, or stereo mode.
 * Therefore swapping Mono → Cardboard → immersive-vr does not touch this file.
 */
export function attachInteraction(
  scene: THREE.Scene,
  deps: InteractionDeps,
): () => void {
  const raycaster = new THREE.Raycaster()
  let disposed = false

  function step() {
    if (disposed) return
    const ray = deps.viewRig.getRay()
    raycaster.set(ray.origin, ray.direction)
    const [hit] = raycaster.intersectObjects(scene.children, true)
    if (hit) deps.onHit(hit.object, hit.point)
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)

  return () => {
    disposed = true
  }
}