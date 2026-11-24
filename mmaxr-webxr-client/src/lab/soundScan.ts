/*
 * A simplified 2D ultrasound scan. A small patch of tissue holds an organ wall, a cyst and two tiny structures. What
 * the scanner shows is that patch seen through its own wavelength: details much smaller than the wavelength simply
 * cannot be separated, so audible sound (wavelengths of tens of centimetres) gives a blur and 5 MHz ultrasound
 * (about a third of a millimetre) gives a sharp picture.
 */
export const PATCH_MM = 60
const PX = 5
export const SIZE = PATCH_MM * PX

export interface ScanKind {
  /** Wavelength in tissue, in millimetres. */
  lambdaMm: number
  label: string
}

/** A tiny deterministic generator so every scan of a given session looks the same. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** Where the echoes come from: 1 on a reflecting boundary, 0 elsewhere, plus faint tissue speckle. */
function reflectivity(cystMm: number, seed: number): Float32Array {
  const r = rng(seed)
  const m = new Float32Array(SIZE * SIZE)
  for (let i = 0; i < m.length; i++) m[i] = 0.06 + r() * 0.08
  const ring = (cx: number, cy: number, rx: number, ry: number, w: number, v: number) => {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const d = Math.hypot((x / PX - cx) / rx, (y / PX - cy) / ry)
        const edge = Math.abs(d - 1) * Math.min(rx, ry)
        if (edge < w) m[y * SIZE + x] = Math.max(m[y * SIZE + x], v)
      }
  }
  ring(30, 30, 24, 19, 0.45, 0.9) // organ wall
  ring(22 + (seed % 5), 30, cystMm / 2, cystMm / 2, 0.4, 1) // the cyst
  const dot = (cx: number, cy: number) => ring(cx, cy, 0.9, 0.9, 0.9, 1)
  dot(40, 24)
  dot(41.8, 36)
  return m
}

/** Separable box blurs: three passes approximate a Gaussian. */
function blur(src: Float32Array, radiusPx: number): Float32Array {
  if (radiusPx < 0.6) return src
  let a: Float32Array = src
  const pass = (data: Float32Array, horizontal: boolean) => {
    const out = new Float32Array(data.length)
    const R = Math.min(SIZE, Math.max(1, Math.round(radiusPx)))
    for (let line = 0; line < SIZE; line++) {
      let sum = 0
      let count = 0
      const at = (i: number) => (horizontal ? data[line * SIZE + i] : data[i * SIZE + line])
      for (let i = -R; i <= R; i++)
        if (i >= 0 && i < SIZE) {
          sum += at(i)
          count++
        }
      for (let i = 0; i < SIZE; i++) {
        const v = sum / count
        if (horizontal) out[line * SIZE + i] = v
        else out[i * SIZE + line] = v
        const add = i + R + 1
        const rem = i - R
        if (add < SIZE) {
          sum += at(add)
          count++
        }
        if (rem >= 0) {
          sum -= at(rem)
          count--
        }
      }
    }
    return out
  }
  for (let k = 0; k < 3; k++) a = pass(pass(a, true), false)
  return a
}

/** The picture the scanner builds for one wavelength, as grey levels 0..255. */
export function scanImage(kind: ScanKind, cystMm: number, seed: number): Uint8ClampedArray {
  const sigmaMm = kind.lambdaMm / 2
  const blurred = blur(reflectivity(cystMm, seed), (sigmaMm * PX) / 1.7)
  let lo = Infinity
  let hi = -Infinity
  for (const v of blurred) {
    lo = Math.min(lo, v)
    hi = Math.max(hi, v)
  }
  const span = Math.max(hi - lo, 0.03)
  const out = new Uint8ClampedArray(SIZE * SIZE * 4)
  for (let i = 0; i < blurred.length; i++) {
    const g = Math.round(255 * Math.pow((blurred[i] - lo) / span, 0.9))
    out[i * 4] = g * 0.82
    out[i * 4 + 1] = g
    out[i * 4 + 2] = g * 0.9
    out[i * 4 + 3] = 255
  }
  return out
}

/** Draw the scan line by line, like a probe sweeping across, and resolve when it is complete. */
export function playScan(canvas: HTMLCanvasElement, pixels: Uint8ClampedArray, seconds = 1.6): Promise<void> {
  canvas.width = SIZE
  canvas.height = SIZE
  const g = canvas.getContext('2d')!
  const img = new ImageData(pixels as unknown as Uint8ClampedArray<ArrayBuffer>, SIZE, SIZE)
  g.fillStyle = '#02060a'
  g.fillRect(0, 0, SIZE, SIZE)
  return new Promise((resolve) => {
    const t0 = performance.now()
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / (seconds * 1000))
      const cols = Math.max(1, Math.floor(k * SIZE))
      g.putImageData(img, 0, 0, 0, 0, cols, SIZE)
      g.fillStyle = 'rgba(120,255,220,0.8)'
      if (k < 1) g.fillRect(cols, 0, 2, SIZE)
      if (k < 1) requestAnimationFrame(step)
      else resolve()
    }
    step()
  })
}
