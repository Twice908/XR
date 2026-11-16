import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export function createScene(): THREE.Scene {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x0b1020)

  const hemi = new THREE.HemisphereLight(0xffffff, 0x223344, 1.2)
  scene.add(hemi)

  const key = new THREE.DirectionalLight(0xffffff, 1.5)
  key.position.set(3, 5, 2)
  scene.add(key)

  const grid = new THREE.GridHelper(10, 20, 0x334466, 0x1a2233)
  scene.add(grid)

  return scene
}

export async function loadModel(
  scene: THREE.Scene,
  modelUrl: string,
): Promise<THREE.Group> {
  const gltf = await new GLTFLoader().loadAsync(modelUrl)
  gltf.scene.name = 'spectrometer'
  scene.add(gltf.scene)
  return gltf.scene
}