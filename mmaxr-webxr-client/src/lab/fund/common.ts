import * as THREE from 'three'
import type { FundamentalsScene } from '../fundamentalsScene'
import { CanvasPanel, fx } from '../fundamentalsScene'

/** The stopwatch model with a turning hand (one turn a minute) and a digital readout under it. */
export function stopwatch(k: FundamentalsScene, height = 2.4): { group: THREE.Group; set(seconds: number): void } {
  const group = new THREE.Group()
  const body = k.fit(k.models.stopwatch, {
    height,
    fallback: () => {
      const f = new THREE.Group()
      const disc = k.mesh(new THREE.CylinderGeometry(height * 0.42, height * 0.42, 0.3, 40).rotateX(Math.PI / 2), k.mat(0xd7263d, 0.5, 0.4))
      disc.position.y = height * 0.42
      f.add(disc)
      return f
    },
  })
  group.add(body)
  // the model's second part is the hand: find it so it can turn
  let hand: THREE.Object3D | null = null
  body.traverse((o) => {
    if (!hand && /rotor/i.test(o.name)) hand = o
  })
  const display = new CanvasPanel(height * 0.9, height * 0.3)
  display.position.set(0, -height * 0.2, 0.3)
  group.add(display)
  const set = (s: number) => {
    if (hand) (hand as THREE.Object3D).rotation.z = -(s / 60) * Math.PI * 2
    display.card()
    display.text(`${fx(s, 2)} s`, display.W / 2, display.H / 2 + 2, Math.round(display.H * 0.6), '#5ee6ff', 'center', 800)
    display.flush()
  }
  set(0)
  return { group, set }
}

/** A glass bulb on a little base, with a light whose glow you can set from 0 to 1. */
export function bulb(k: FundamentalsScene, size = 1): { group: THREE.Group; glow(level: number): void } {
  const group = new THREE.Group()
  const base = k.mesh(new THREE.CylinderGeometry(0.35 * size, 0.42 * size, 0.7 * size, 20), k.mat(0x9aa3b2, 0.9, 0.3))
  base.position.y = 0.35 * size
  const glassMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, transparent: true, opacity: 0.35, roughness: 0.05, emissive: 0xffd27a, emissiveIntensity: 0 })
  const glass = k.mesh(new THREE.SphereGeometry(0.7 * size, 28, 20), glassMat, false)
  glass.position.y = 1.35 * size
  const filMat = new THREE.MeshBasicMaterial({ color: 0x553311 })
  const fil = new THREE.Mesh(new THREE.TorusGeometry(0.18 * size, 0.03 * size, 6, 16, Math.PI), filMat)
  fil.position.y = 1.3 * size
  const light = new THREE.PointLight(0xffd27a, 0, 14 * size, 1.6)
  light.position.y = 1.35 * size
  group.add(base, glass, fil, light)
  const glow = (level: number) => {
    const l = Math.max(0, Math.min(1, level))
    glassMat.emissiveIntensity = l * 2.2
    glassMat.opacity = 0.35 + l * 0.4
    filMat.color.setRGB(0.33 + l * 0.67, 0.2 + l * 0.75, 0.07 + l * 0.5)
    light.intensity = l * 40
  }
  glow(0)
  return { group, glow }
}

/** A crate from the model, or a box. */
export function crate(k: FundamentalsScene, size = 1.8): THREE.Group {
  return k.fit(k.models.crate, { height: size, fallback: () => k.mesh(new THREE.BoxGeometry(size, size, size), k.mat(0xb07a3d, 0.1, 0.8)) })
}

/** A vertical bar meter (for work and energy) that fills up to a level. */
export function barMeter(k: FundamentalsScene, color: number, height: number, name: string): { group: THREE.Group; set(frac: number, text: string): void } {
  const group = new THREE.Group()
  const frame = new THREE.Mesh(new THREE.BoxGeometry(1.05, height + 0.1, 1.05), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.25 }))
  frame.position.y = height / 2
  const fill = k.mesh(new THREE.BoxGeometry(0.9, 1, 0.9), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.4 }), false)
  fill.geometry.translate(0, 0.5, 0)
  fill.scale.y = 0.001
  const nameTag = k.label(name, '#e6edf7', 0.5)
  nameTag.position.y = -0.5
  const value = new CanvasPanel(2.2, 0.6)
  value.position.y = height + 0.6
  group.add(frame, fill, nameTag, value)
  k.idle.add(() => value.quaternion.copy(k.camera.quaternion))
  const set = (frac: number, text: string) => {
    fill.scale.y = Math.max(0.001, Math.min(1.15, frac)) * height
    value.card('rgba(8,12,20,0.7)')
    value.text(text, value.W / 2, value.H / 2 + 2, Math.round(value.H * 0.5), '#' + new THREE.Color(color).getHexString(), 'center', 800)
    value.flush()
  }
  set(0, '0 J')
  return { group, set }
}
