import type { Sample, SensorData } from './types';

/**
 * Parse the 30 Hz sensor CSV by header name, so the web client's
 * `timestamp,head_x,...,hand_z` and the Unity client's
 * `timestamp,headX,...,leftX...,rightX...` both work.
 */
export function parseSensorCsv(csv: string): SensorData | null {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const header = lines[0].split(',').map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const num = (cols: string[], i: number) => (i >= 0 ? Number(cols[i]) : NaN);

  const isWeb = idx('head_x') >= 0;
  const isVr = idx('headX') >= 0 && (idx('rightX') >= 0 || idx('leftX') >= 0);
  if (!isWeb && !isVr) return null;

  const samples: Sample[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const t = Number(c[0]);
    if (!Number.isFinite(t)) continue;
    let head: [number, number, number];
    let hand: [number, number, number];
    if (isWeb) {
      head = [num(c, idx('head_x')), num(c, idx('head_y')), num(c, idx('head_z'))];
      hand = [num(c, idx('hand_x')), num(c, idx('hand_y')), num(c, idx('hand_z'))];
    } else {
      head = [num(c, idx('headX')), num(c, idx('headY')), num(c, idx('headZ'))];
      // Right hand is the dominant tracker; fall back to the left one.
      const useRight = idx('rightX') >= 0;
      const p = useRight ? 'right' : 'left';
      hand = [num(c, idx(`${p}X`)), num(c, idx(`${p}Y`)), num(c, idx(`${p}Z`))];
    }
    if ([...head, ...hand].some((n) => !Number.isFinite(n))) continue;
    samples.push({ t, head, hand });
  }
  return samples.length ? { format: isWeb ? 'web' : 'vr', samples } : null;
}

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Path length (metres) of one tracked point between two timestamps. Jumps over 0.5 m in one step are tracking glitches. */
export function travel(data: SensorData | null, which: 'head' | 'hand', from: number, to: number): number {
  if (!data) return 0;
  let total = 0;
  let prev: Sample | null = null;
  for (const s of data.samples) {
    if (s.t < from || s.t > to) continue;
    if (prev) {
      const d = dist(prev[which], s[which]);
      if (d < 0.5) total += d;
    }
    prev = s;
  }
  return total;
}
