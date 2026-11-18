import * as THREE from 'three'
import type { ViewRig } from './viewRig'

export interface InteractionDeps {
  viewRig: ViewRig
  renderer: THREE.WebGLRenderer
  onClick: (object: THREE.Object3D, point: THREE.Vector3) => void
}

/**
 * Click-based raycasting.
 * - Non-XR: uses mouse position
 * - XR: uses view rig gaze (center)
 * Returns a dispose function.
 */
export function attachInteraction(
  scene: THREE.Scene,
  deps: InteractionDeps,
): () => void {
  const raycaster = new THREE.Raycaster()
  const canvas = deps.renderer.domElement
  const pointer = new THREE.Vector2()
  let disposed = false

  function handleClick(event: MouseEvent) {
    if (disposed) return

    if (deps.renderer.xr.isPresenting) {
      const ray = deps.viewRig.getRay()
      raycaster.set(ray.origin, ray.direction)
    } else {
      const rect = canvas.getBoundingClientRect()
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, deps.viewRig.camera)
    }

    const [hit] = raycaster.intersectObjects(scene.children, true)
    if (hit) deps.onClick(hit.object, hit.point)
  }

  canvas.addEventListener('click', handleClick)
  return () => {
    disposed = true
    canvas.removeEventListener('click', handleClick)
  }
}