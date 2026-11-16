import * as THREE from 'three'

export interface ViewRig {
  readonly camera: THREE.Camera
  /** Called once per frame */
  update(dt: number): void
  /** Render scene through this rig */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void
  /** World-space ray from the user's "pointer" — used by interaction */
  getRay(): THREE.Ray
  dispose(): void
}

/** Today's implementation: single PerspectiveCamera. */
export class MonoViewRig implements ViewRig {
  readonly camera: THREE.PerspectiveCamera
  private raycaster = new THREE.Raycaster()

  constructor(canvasAspect: number) {
    this.camera = new THREE.PerspectiveCamera(75, canvasAspect, 0.05, 100)
    this.camera.position.set(0, 1.6, 2)
  }

  update(_dt: number) {
    this.camera.updateMatrixWorld()
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    renderer.render(scene, this.camera)
  }

  getRay(): THREE.Ray {
    // Later: read XR controller pose. Today: forward from camera center.
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera)
    return this.raycaster.ray
  }

  dispose() {}
}

/**
 * Reserved for Cardboard (StereoEffect injection):
 *
 *   export class CardboardViewRig implements ViewRig {
 *     private effect = new StereoEffect(renderer)
 *     render(renderer, scene) { this.effect.render(scene, this.camera) }
 *     getRay() { /* same as Mono — stereo gaze is centered *\/ }
 *   }
 *
 * Swap at boot based on ?mode=cardboard. Interaction code is unchanged.
 */