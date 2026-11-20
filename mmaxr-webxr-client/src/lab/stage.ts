import * as THREE from 'three'

/**
 * A lit stage for one module: a glossy platform with a glowing edge, an optional back wall, a key spotlight
 * with shadows, amber and cyan rim lights and dust. Sizes are in metres, centred on (cx, cz).
 */
export function stageSet(g: THREE.Group, o: { cx: number; cz: number; w: number; d: number; wall?: { z: number; h: number }; key: [number, number, number]; aim: [number, number, number]; keyI: number; rimI: number; rimAt: [number, number, number]; dust?: { n: number; h: number } }) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), new THREE.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.7, metalness: 0.1 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.4
  floor.receiveShadow = true
  g.add(floor)
  const deck = new THREE.Mesh(new THREE.BoxGeometry(o.w, 0.34, o.d), new THREE.MeshStandardMaterial({ color: 0x151a22, roughness: 0.36, metalness: 0.25 }))
  deck.position.set(o.cx, -0.2, o.cz)
  deck.receiveShadow = true
  g.add(deck)
  // glowing edge, like the rings on the biology stage
  const glow = new THREE.MeshBasicMaterial({ color: 0x4f8cff, transparent: true, opacity: 0.55, depthWrite: false })
  const t = Math.max(0.06, o.w / 600)
  for (const [w, d, x, z] of [
    [o.w, t, o.cx, o.cz - o.d / 2],
    [o.w, t, o.cx, o.cz + o.d / 2],
    [t, o.d, o.cx - o.w / 2, o.cz],
    [t, o.d, o.cx + o.w / 2, o.cz],
  ] as const) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), glow)
    e.position.set(x, 0.0, z)
    g.add(e)
  }
  if (o.wall) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(o.w * 1.3, o.wall.h), new THREE.MeshStandardMaterial({ color: 0x1b2029, roughness: 0.85 }))
    wall.position.set(o.cx, o.wall.h / 2 - 0.2, o.wall.z)
    wall.receiveShadow = true
    g.add(wall)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(o.w * 1.3, 0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.5 }))
    strip.position.set(o.cx, 0.3, o.wall.z + 0.05)
    g.add(strip)
  }
  const key = new THREE.SpotLight(0xfff3e0, o.keyI, 0, Math.PI / 4.2, 0.7, 1.6)
  key.position.set(...o.key)
  key.target.position.set(...o.aim)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.bias = -0.0004
  g.add(key, key.target)
  const rimA = new THREE.PointLight(0xf59e0b, o.rimI, 0, 2)
  rimA.position.set(o.cx - o.rimAt[0], o.rimAt[1], o.cz + o.rimAt[2])
  const rimB = new THREE.PointLight(0x22d3ee, o.rimI * 0.8, 0, 2)
  rimB.position.set(o.cx + o.rimAt[0], o.rimAt[1] * 0.9, o.cz + o.rimAt[2])
  g.add(rimA, rimB)
  if (o.dust) {
    const pos = new Float32Array(o.dust.n * 3)
    for (let i = 0; i < o.dust.n; i++) {
      pos[i * 3] = o.cx + (Math.random() - 0.5) * o.w
      pos[i * 3 + 1] = Math.random() * o.dust.h
      pos[i * 3 + 2] = o.cz + (Math.random() - 0.5) * o.d
    }
    const dg = new THREE.BufferGeometry()
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xcdd6ff, size: 0.03, transparent: true, opacity: 0.3, depthWrite: false }))
    g.add(dust)
  }
}
