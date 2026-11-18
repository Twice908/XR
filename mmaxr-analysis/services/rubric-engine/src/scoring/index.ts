import { scoreChemistry } from './chemistry';
import { scorePhysics } from './physics';
import type { Device, EventRow, Report, SensorData } from './types';

export * from './types';
export { parseSensorCsv } from './sensors';

/** The device a session was recorded on: the events say so; otherwise the sensor file's format does. */
export function detectDevice(events: EventRow[], sensor: SensorData | null): Device {
  const counts = { web: 0, vr: 0 };
  for (const e of events) if (e.device === 'web' || e.device === 'vr') counts[e.device]++;
  if (counts.web || counts.vr) return counts.vr > counts.web ? 'vr' : 'web';
  return sensor ? sensor.format : 'unknown';
}

export function detectLesson(events: EventRow[]): Report['lessonType'] {
  const entered = events.find((e) => e.object_data?.action === 'enter_lab');
  const target = String(entered?.object_data?.target ?? '');
  if (target.startsWith('chemistry') || events.some((e) => e.object_data?.action === 'predict_color')) return 'chemistry_indicators';
  if (target.startsWith('physics') || events.some((e) => e.verb === 'noticed_anomaly')) return 'physics_bohr';
  return 'unknown';
}

export function analyze(events: EventRow[], sensor: SensorData | null): Report {
  const ordered = [...events].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id);
  const device = detectDevice(ordered, sensor);
  return detectLesson(ordered) === 'physics_bohr' ? scorePhysics(ordered, sensor, device) : scoreChemistry(ordered, sensor, device);
}
