import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { baseColorName } from '../services/colors'
import type { ChemistryLessonContract } from '../services/lessons'

const COLOR_MAP: Record<string, { hex: number; opacity: number }> = {
  clear: { hex: 0xffffff, opacity: 0.15 },
  colorless: { hex: 0xffffff, opacity: 0.15 },
  red: { hex: 0xef4444, opacity: 0.9 },
  blue: { hex: 0x3b82f6, opacity: 0.9 },
  purple: { hex: 0xa855f7, opacity: 0.9 },
  pink: { hex: 0xec4899, opacity: 0.9 },
  yellow: { hex: 0xeab308, opacity: 0.9 },
  green: { hex: 0x22c55e, opacity: 0.9 },
  orange: { hex: 0xf97316, opacity: 0.9 },
  brown: { hex: 0x92400e, opacity: 0.9 },
  grey: { hex: 0x71717a, opacity: 0.9 },
  gray: { hex: 0x71717a, opacity: 0.9 },
}

export function resolveColor(name: string): { hex: number; opacity: number } {
  const raw = (name ?? '').toLowerCase().trim()
  const key = /[/-]/.test(raw) ? baseColorName(raw) : raw
  if (!key) return { hex: 0xffffff, opacity: 0.15 }

  const paleMatch = key.match(/^(pale|light|pale |light )(.+)$/)
  if (paleMatch) {
    const base = resolveColor(paleMatch[2])
    const c = new THREE.Color(base.hex).lerp(new THREE.Color(0xffffff), 0.45)
    return { hex: c.getHex(), opacity: base.opacity * 0.75 }
  }
  const deepMatch = key.match(/^(deep|dark|deep |dark )(.+)$/)
  if (deepMatch) {
    const base = resolveColor(deepMatch[2])
    const c = new THREE.Color(base.hex).lerp(new THREE.Color(0x000000), 0.3)
    return { hex: c.getHex(), opacity: base.opacity }
  }

  return COLOR_MAP[key] ?? { hex: 0xa1a1aa, opacity: 0.85 }
}

const LIQUID_NAME = /liquid|fluid/i
const GLASS_OPACITY = 0.3

export interface TubeHandle {
  group: THREE.Group
  liquid: THREE.Mesh
  setColor: (name: string) => void
}

export interface ChemistryScene {
  tubes: TubeHandle[]
  getTubeIndexFromObject: (obj: THREE.Object3D) => number | null
  dispose: () => void
}

function deriveAssetUrl(baseUrl: string, filename: string): string {
  const idx = baseUrl.lastIndexOf('/')
  return idx >= 0 ? baseUrl.slice(0, idx + 1) + filename : filename
}

export async function loadChemistryScene(
  scene: THREE.Scene,
  lesson: ChemistryLessonContract,
): Promise<ChemistryScene> {
  const loader = new GLTFLoader()

  const tubeUrl = lesson.assets?.testTube ?? deriveAssetUrl(lesson.modelUrl, 'test_tube.glb')
  const erlenmeyerUrl =
    lesson.assets?.erlenmeyer ?? deriveAssetUrl(lesson.modelUrl, 'erlenmeyer_flask.glb')
  const dropperUrl =
    lesson.assets?.dropper ?? deriveAssetUrl(lesson.modelUrl, 'dropper.glb')

  console.info('[chem] loading assets', { tubeUrl, erlenmeyerUrl, dropperUrl })

  const [tubeGltf, erlenmeyerGltf, dropperGltf] = await Promise.all([
    loader.loadAsync(tubeUrl).catch((err) => {
      console.warn('[chem] test tube load failed — using fallback cylinder', err)
      return null
    }),
    loader.loadAsync(erlenmeyerUrl).catch((err) => {
      console.warn('[chem] erlenmeyer load failed', err)
      return null
    }),
    loader.loadAsync(dropperUrl).catch((err) => {
      console.warn('[chem] dropper load failed', err)
      return null
    }),
  ])

  const tubes: TubeHandle[] = []
  const tubeCount = lesson.assignedSolutions.length
  
  // Scaled up for visibility
  const SPACING = 0.8 
  const centerX = ((tubeCount - 1) * SPACING) / 2
  const OFFSET_X = -1.2 // Shift tubes to the left to clear the sidebar

  for (let i = 0; i < tubeCount; i++) {
    const group = new THREE.Group()
    group.position.set(i * SPACING - centerX + OFFSET_X, 0.0, 0)
    group.userData.tubeIndex = i

    // Tube shell (+ optional model-provided liquid mesh)
    let liquid: THREE.Mesh | null = null
    if (tubeGltf) {
      const tube = tubeGltf.scene.clone(true)
      const box = new THREE.Box3().setFromObject(tube)
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z) || 1
      tube.scale.setScalar(0.8 / maxDim)
      const box2 = new THREE.Box3().setFromObject(tube)
      tube.position.y -= box2.min.y
      group.add(tube)

      // clone() shares materials between clones -> give every mesh its own
      // material so tubes can be tinted independently.
      tube.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        child.material = Array.isArray(child.material)
          ? child.material.map((m) => m.clone())
          : child.material.clone()
        if (!liquid && LIQUID_NAME.test(child.name)) {
          liquid = child
        }
      })
      // Everything that is not the liquid is glass: translucent so liquid shows through.
      tube.traverse((child) => {
        if (!(child instanceof THREE.Mesh) || child === liquid) return
        for (const m of Array.isArray(child.material) ? child.material : [child.material]) {
          m.transparent = true
          m.opacity = GLASS_OPACITY
          m.depthWrite = false
        }
      })
    } else {
      const shell = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.15, 0.8, 20, 1, true),
        new THREE.MeshStandardMaterial({
          color: 0xe4e4e7, transparent: true, opacity: GLASS_OPACITY,
          roughness: 0.1, metalness: 0.1, side: THREE.DoubleSide, depthWrite: false,
        }),
      )
      shell.position.y = 0.4
      group.add(shell)
    }

    // No "Liquid"/"Fluid" mesh in the model -> spawn a water cylinder inside the glass.
    if (!liquid) {
      liquid = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 0.5, 20),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0 }),
      )
      liquid.name = 'Liquid'
      liquid.position.y = 0.3
      group.add(liquid)
    }

    const liquidMesh: THREE.Mesh = liquid
    const liquidMat = (Array.isArray(liquidMesh.material) ? liquidMesh.material[0] : liquidMesh.material) as THREE.MeshStandardMaterial
    liquidMat.transparent = true
    liquidMat.opacity = 0.15
    liquidMat.depthWrite = false
    liquidMesh.renderOrder = 1 // draw after glass

    group.traverse((child) => {
      child.userData.tubeIndex = i
    })

    scene.add(group)

    tubes.push({
      group,
      liquid: liquidMesh,
      setColor(name: string) {
        const c = resolveColor(name)
        liquidMat.color.setHex(c.hex)
        if (liquidMat.emissive) {
          liquidMat.emissive.setHex(c.hex)
          liquidMat.emissiveIntensity = 0.1
        }
        liquidMat.opacity = c.opacity
        liquidMat.needsUpdate = true
      },
    })
  }

  // Decorative props (scaled and moved left)
  if (erlenmeyerGltf) {
    const flask = erlenmeyerGltf.scene.clone(true)
    flask.position.set(-2.8, 0.0, 0.15)
    scene.add(flask)
  }
  if (dropperGltf) {
    const dropper = dropperGltf.scene.clone(true)
    dropper.position.set(0.5, 0.0, 0.15)
    scene.add(dropper)
  }

  return {
    tubes,
    getTubeIndexFromObject(obj: THREE.Object3D): number | null {
      let current: THREE.Object3D | null = obj
      while (current) {
        const idx = current.userData.tubeIndex
        if (typeof idx === 'number') return idx
        current = current.parent
      }
      return null
    },
    dispose() {
      for (const t of tubes) {
        t.group.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose()
            const mat = child.material
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
            else mat.dispose()
          }
        })
        scene.remove(t.group)
      }
    },
  }
}