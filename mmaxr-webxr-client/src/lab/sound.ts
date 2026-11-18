/** Small WebAudio synth for lab feedback: nothing is downloaded, and it stays silent until the student interacts. */
const KEY = 'mmaxr.sound'
let ctx: AudioContext | null = null
let muted = false
try {
  muted = localStorage.getItem(KEY) === 'off'
} catch {
  /* ignore */
}

function ac(): AudioContext | null {
  if (muted) return null
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function noise(c: AudioContext, seconds: number): AudioBufferSourceNode {
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * seconds)), c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const src = c.createBufferSource()
  src.buffer = buf
  return src
}

function tone(freq: number, seconds: number, gain: number, type: OscillatorType = 'sine', slideTo?: number) {
  const c = ac()
  if (!c) return
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, c.currentTime)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, c.currentTime + seconds)
  g.gain.setValueAtTime(gain, c.currentTime)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + seconds)
  o.connect(g).connect(c.destination)
  o.start()
  o.stop(c.currentTime + seconds)
}

function burst(seconds: number, gain: number, filter: BiquadFilterType, freq: number) {
  const c = ac()
  if (!c) return
  const n = noise(c, seconds)
  const f = c.createBiquadFilter()
  f.type = filter
  f.frequency.value = freq
  const g = c.createGain()
  g.gain.setValueAtTime(gain, c.currentTime)
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + seconds)
  n.connect(f).connect(g).connect(c.destination)
  n.start()
}

export const sound = {
  get muted() {
    return muted
  },
  setMuted(m: boolean) {
    muted = m
    try {
      localStorage.setItem(KEY, m ? 'off' : 'on')
    } catch {
      /* ignore */
    }
  },
  hit() {
    tone(110, 0.22, 0.3, 'sine', 45)
    burst(0.06, 0.25, 'lowpass', 900)
  },
  ring() {
    tone(1180, 1.4, 0.1)
    tone(1770, 1.1, 0.05)
    tone(2650, 0.8, 0.03)
  },
  thud() {
    tone(95, 0.2, 0.25, 'sine', 50)
  },
  crack() {
    burst(0.14, 0.3, 'highpass', 1800)
  },
  plop() {
    tone(420, 0.12, 0.16, 'sine', 160)
  },
  fizz(seconds = 1.4) {
    burst(seconds, 0.1, 'bandpass', 2600)
  },
  whoosh(seconds = 0.9) {
    burst(seconds, 0.16, 'lowpass', 700)
  },
  click() {
    tone(660, 0.06, 0.08, 'triangle')
  },
  spark() {
    burst(0.2, 0.08, 'highpass', 4000)
  },
}
