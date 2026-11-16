import * as THREE from 'three'
import { MonoViewRig, type ViewRig } from './viewRig'

export interface RendererBundle {
  renderer: THREE.WebGLRenderer
  viewRig: ViewRig
  startLoop: (tick: (dt: number) => void) => void
  tryEnterVr: () => Promise<void>
  dispose: () => void
}

export function createRenderer(canvas: HTMLCanvasElement): RendererBundle {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.xr.enabled = true

  const viewRig = new MonoViewRig(window.innerWidth / window.innerHeight)

  const onResize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight)
    if (viewRig.camera instanceof THREE.PerspectiveCamera) {
      viewRig.camera.aspect = window.innerWidth / window.innerHeight
      viewRig.camera.updateProjectionMatrix()
    }
  }
  window.addEventListener('resize', onResize)

  const clock = new THREE.Clock()

  return {
    renderer,
    viewRig,
    startLoop(tick) {
      renderer.setAnimationLoop(() => {
        const dt = clock.getDelta()
        viewRig.update(dt)
        tick(dt)
      })
    },
    async tryEnterVr() {
      if (!('xr' in navigator)) return
      const xr = (navigator as Navigator & {
        xr: { isSessionSupported(mode: string): Promise<boolean>; requestSession(mode: string): Promise<XRSession> }
      }).xr
      const supported = await xr.isSessionSupported('immersive-vr').catch(() => false)
      if (!supported) return
      const session = await xr.requestSession('immersive-vr')
      await renderer.xr.setSession(session)
    },
    dispose() {
      window.removeEventListener('resize', onResize)
      renderer.setAnimationLoop(null)
      renderer.dispose()
    },
  }
}