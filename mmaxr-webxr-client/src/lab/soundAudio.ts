import { sound } from './sound'

/*
 * What the student actually hears. A clap is a short burst of noise; in the open field it is heard once, in a small
 * room it is smeared by a reverberation tail, and a shout towards a cliff comes back as a separate, later copy.
 * Everything is synthesised: no audio files.
 */
let ctx: AudioContext | null = null
const ac = (): AudioContext | null => {
  if (sound.muted) return null
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function noise(c: AudioContext, seconds: number, decay = 0): AudioBuffer {
  const n = Math.max(1, Math.floor(c.sampleRate * seconds))
  const b = c.createBuffer(1, n, c.sampleRate)
  const d = b.getChannelData(0)
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (decay ? Math.exp((-i / n) * decay) : 1)
  return b
}

function burstAt(c: AudioContext, at: number, gain: number, kind: 'clap' | 'shout', out: AudioNode) {
  const src = c.createBufferSource()
  src.buffer = noise(c, kind === 'clap' ? 0.09 : 0.45, kind === 'clap' ? 7 : 2.5)
  const f = c.createBiquadFilter()
  f.type = kind === 'clap' ? 'highpass' : 'bandpass'
  f.frequency.value = kind === 'clap' ? 1400 : 700
  f.Q.value = kind === 'clap' ? 0.7 : 1.4
  const g = c.createGain()
  g.gain.setValueAtTime(gain, at)
  src.connect(f).connect(g).connect(out)
  src.start(at)
}

export const acoustics = {
  /** A clap in the open field: once, and nothing comes back. */
  clapField() {
    const c = ac()
    if (c) burstAt(c, c.currentTime, 0.6, 'clap', c.destination)
  },
  /** A clap in the small room: the same burst, then a tail of overlapping reflections lasting about `rt` seconds. */
  clapRoom(rt: number) {
    const c = ac()
    if (!c) return
    const conv = c.createConvolver()
    conv.buffer = noise(c, rt * 1.1, 6.9 / rt)
    const wet = c.createGain()
    wet.gain.value = 1.6
    conv.connect(wet).connect(c.destination)
    burstAt(c, c.currentTime, 0.45, 'clap', c.destination)
    burstAt(c, c.currentTime, 0.5, 'clap', conv)
  },
  /** A shout now, and its echo `delay` seconds later. */
  shoutWithEcho(delay: number) {
    const c = ac()
    if (!c) return
    burstAt(c, c.currentTime, 0.55, 'shout', c.destination)
    burstAt(c, c.currentTime + delay, 0.28, 'shout', c.destination)
  },
  /** A sonar ping now and its echo `delay` seconds later. */
  sonar(delay: number) {
    const c = ac()
    if (!c) return
    const ping = (at: number, gain: number) => {
      const o = c.createOscillator()
      const g = c.createGain()
      o.frequency.value = 1500
      g.gain.setValueAtTime(0.0001, at)
      g.gain.exponentialRampToValueAtTime(gain, at + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.22)
      o.connect(g).connect(c.destination)
      o.start(at)
      o.stop(at + 0.25)
    }
    ping(c.currentTime, 0.22)
    ping(c.currentTime + delay, 0.1)
  },
}
