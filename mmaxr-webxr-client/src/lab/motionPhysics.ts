/*
 * Pure, deterministic physics for the motion sandbox: no Three.js, so it can be tested on its own.
 * The scene only draws what these functions say. None of it names an answer; it just simulates.
 */

export const G = 9.8

// ---- the track ----
/** A 50 m straight leads into a circular track. The car's lap is exactly 100 m long. */
export const LEAD = 50
export const LAP = 100
export const LOOP_R = LAP / (2 * Math.PI)
/** World z of the straight and of the loop's entry point. */
export const TRACK_Z = 15
export const LOOP_CENTER = { x: 0, z: TRACK_Z - LOOP_R }

export interface Pose {
  x: number
  z: number
  /** Direction of travel, anticlockwise from +x when seen from above. */
  heading: number
}

/** Where the car is after driving s metres from the start of the straight. */
export function carAt(s: number): Pose {
  if (s <= LEAD) return { x: -LEAD + s, z: TRACK_Z, heading: 0 }
  const a = (s - LEAD) / LOOP_R
  return { x: LOOP_R * Math.sin(a), z: LOOP_CENTER.z + LOOP_R * Math.cos(a), heading: a }
}

export const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))

export interface DriveProfile {
  from: number
  to: number
  /** Seconds of simulated time, and how many simulated seconds pass per real second. */
  duration: number
  playback: number
  /** Distance along the path after t simulated seconds. */
  at(t: number): number
}

export interface DriveParams {
  /** Moves along the straight, in metres: positive forwards, negative back. */
  legs?: number[]
  /** How much of the 100 m loop to drive. */
  frac?: number
  speed?: number
  /** 'straight' makes a steady-speed drive along the straight instead of round the loop. */
  mode?: string
  length?: number
}

/** The drive for an action, with this session's values. */
export function profile(action: string, p: DriveParams = {}): DriveProfile | null {
  if (action === 'drive_straight') {
    const legs = p.legs?.length ? p.legs : [LEAD]
    const segs = legs.map((d) => ({ d, dur: Math.max(2.4, Math.abs(d) / 7) }))
    const pause = 0.6
    const duration = segs.reduce((a, x) => a + x.dur, 0) + pause * (segs.length - 1)
    const end = legs.reduce((a, x) => a + x, 0)
    return {
      from: 0,
      to: end,
      duration,
      playback: 1,
      at: (t) => {
        let pos = 0
        let left = t
        for (let i = 0; i < segs.length; i++) {
          const g = segs[i]
          if (left < g.dur) return pos + g.d * smooth(left / g.dur)
          left -= g.dur
          pos += g.d
          if (i < segs.length - 1) {
            if (left < pause) return pos
            left -= pause
          }
        }
        return pos
      },
    }
  }
  if (action === 'drive_lap') {
    const fr = p.frac ?? 1
    const dur = 6 + 8 * fr
    return { from: LEAD, to: LEAD + LAP * fr, duration: dur, playback: 1, at: (t) => LEAD + LAP * fr * smooth(t / dur) }
  }
  if (action === 'drive_lap_steady') {
    const v = p.speed ?? 5
    if (p.mode === 'straight') {
      const len = Math.min(LEAD, p.length ?? LEAD)
      const dur = len / v
      return { from: 0, to: len, duration: dur, playback: dur > 10 ? dur / 10 : 1, at: (t) => v * Math.min(t, dur) }
    }
    const fr = p.frac ?? 1
    const dur = (LAP * fr) / v
    return { from: LEAD, to: LEAD + LAP * fr, duration: dur, playback: dur > 10 ? dur / 10 : 1, at: (t) => LEAD + v * Math.min(t, dur) }
  }
  return null
}

export interface Kinematics {
  distance: number
  displacement: number
  speed: number
  /** Velocity magnitude equals speed; this is its direction in radians. */
  velocityHeading: number
  /** Size of the acceleration: along the path plus towards the centre when circling. */
  accel: number
  /** Direction of the centripetal part, if any (towards the loop centre). */
  towardsCentre: boolean
}

/** Odometer, displacement, speed and acceleration for a drive that began at path position `from`. */
export function kinematics(from: number, s: number, speed: number, tangential: number): Kinematics {
  const a = carAt(from)
  const b = carAt(s)
  const circling = s > LEAD
  const centripetal = circling ? (speed * speed) / LOOP_R : 0
  return {
    distance: Math.abs(s - from),
    displacement: Math.hypot(b.x - a.x, b.z - a.z),
    speed: Math.abs(speed),
    velocityHeading: b.heading,
    accel: Math.hypot(tangential, centripetal),
    towardsCentre: circling,
  }
}

// ---- forces on a crate ----
export interface Push {
  /** Friction force opposing the push. */
  friction: number
  net: number
  accel: number
  moving: boolean
}
/** A crate on a rough floor: static friction matches the push up to its limit, then kinetic friction takes over. */
export function pushOnFloor(force: number, mass: number, muStatic: number, muKinetic: number, moving: boolean): Push {
  const maxStatic = muStatic * mass * G
  if (!moving && force <= maxStatic) return { friction: force, net: 0, accel: 0, moving: false }
  const kinetic = muKinetic * mass * G
  const net = force - kinetic
  return { friction: kinetic, net, accel: net / mass, moving: true }
}

// ---- collisions ----
/** Perfectly elastic head-on collision in one dimension. */
export function elastic(m1: number, v1: number, m2: number, v2: number): [number, number] {
  const s = m1 + m2
  return [((m1 - m2) * v1 + 2 * m2 * v2) / s, ((m2 - m1) * v2 + 2 * m1 * v1) / s]
}

// ---- falling ----
export interface Fall {
  /** Seconds until the object reaches the floor. */
  time: number
  /** Distance fallen and speed after t seconds. */
  at(t: number): { fallen: number; speed: number }
}
/** Falls from rest through `height` metres. terminal = null means no air at all. */
export function simulateFall(height: number, terminal: number | null, dt = 1 / 480): Fall {
  const ys: number[] = [0]
  const vs: number[] = [0]
  let y = 0
  let v = 0
  while (y < height && ys.length < 60 * 480) {
    const a = terminal ? G * (1 - (v / terminal) ** 2) : G
    v += a * dt
    y += v * dt
    ys.push(Math.min(y, height))
    vs.push(v)
  }
  const time = (ys.length - 1) * dt
  return {
    time,
    at: (t) => {
      const i = Math.min(ys.length - 1, Math.max(0, Math.round(t / dt)))
      return { fallen: ys[i], speed: vs[i] }
    },
  }
}

export const DROP_HEIGHT = 4.9
export const BALL_TERMINAL = 60
export const FEATHER_TERMINAL = 1.1

// ---- Newton's cradle ----
/** Angle (radians, signed) of the swinging balls t seconds after release, for pulling back n balls. Left pull is negative. */
export function cradleAngle(t: number, amplitude = 0.7, quarter = 0.4): { left: number; right: number } {
  const phase = Math.floor(t / quarter)
  const u = (t - phase * quarter) / quarter // 0..1 within a quarter swing
  const c = Math.cos((u * Math.PI) / 2)
  const s = Math.sin((u * Math.PI) / 2)
  // 0: left comes down, 1: right goes up, 2: right comes down, 3: left goes up, then repeat
  switch (phase % 4) {
    case 0: return { left: -amplitude * c, right: 0 }
    case 1: return { left: 0, right: amplitude * s }
    case 2: return { left: 0, right: amplitude * c }
    default: return { left: -amplitude * s, right: 0 }
  }
}
