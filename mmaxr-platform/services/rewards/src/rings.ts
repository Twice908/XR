/** Weekly Learning Rings: Explore (active minutes), Master (lessons at the mastery score), Complete (lessons finished). */

export type GoalLevel = 'light' | 'standard' | 'stretch';
export const GOAL_LEVELS: GoalLevel[] = ['light', 'standard', 'stretch'];
const LEVEL_FACTOR: Record<GoalLevel, number> = { light: 0.5, standard: 1, stretch: 1.5 };

export interface RingGoals {
  exploreMinutes: number;
  masterCount: number;
  completeCount: number;
  /** A completed lesson counts towards Master when its score is at least this. */
  masteryPercent: number;
}

export const DEFAULT_GOALS: RingGoals = { exploreMinutes: 60, masterCount: 2, completeCount: 3, masteryPercent: 80 };

/** Gaps longer than this between two events are idle time and do not count towards Explore. */
export const IDLE_GAP_MS = 2 * 60 * 1000;

export function goalsForLevel(base: RingGoals, level: GoalLevel): RingGoals {
  const f = LEVEL_FACTOR[level];
  const scale = (n: number) => Math.max(1, Math.ceil(n * f));
  return { exploreMinutes: scale(base.exploreMinutes), masterCount: scale(base.masterCount), completeCount: scale(base.completeCount), masteryPercent: base.masteryPercent };
}

// ---------- weeks ----------

/** Minutes east of UTC that define when a school week starts (Monday 00:00 local). India by default. */
export const WEEK_OFFSET_MINUTES = Number(process.env.RING_UTC_OFFSET_MINUTES ?? 330);
const DAY = 86_400_000;

/** ISO week key, e.g. "2026-W48", for a millisecond timestamp, in the school's time zone. */
export function weekKey(ts: number, offsetMin = WEEK_OFFSET_MINUTES): string {
  const local = new Date(ts + offsetMin * 60_000);
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow); // the Thursday of this week decides its year
  const year = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/;

/** Start (inclusive) and end (exclusive) of a week, as UTC milliseconds. */
export function weekRange(key: string, offsetMin = WEEK_OFFSET_MINUTES): { start: number; end: number } {
  const m = WEEK_KEY_RE.exec(key);
  if (!m) throw new Error(`Bad week key ${key}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const mondayW1 = Date.UTC(year, 0, 4) - ((jan4.getUTCDay() || 7) - 1) * DAY;
  const start = mondayW1 + (week - 1) * 7 * DAY - offsetMin * 60_000;
  return { start, end: start + 7 * DAY };
}

export function previousWeek(key: string): string {
  return weekKey(weekRange(key).start - DAY);
}

// ---------- progress ----------

export interface WeekEvent {
  sessionId: string;
  timestamp: number;
  action: string | null;
  target: string | null;
}

export interface Ring {
  value: number;
  goal: number;
  percent: number;
  closed: boolean;
}

export interface RingProgress {
  week: string;
  level: GoalLevel;
  explore: Ring;
  master: Ring;
  complete: Ring;
  allClosed: boolean;
  /** Lessons finished this week, and those finished at the mastery score. */
  completedLessons: string[];
  masteredLessons: string[];
}

const ring = (value: number, goal: number): Ring => ({ value, goal, percent: Math.min(100, Math.round((value / goal) * 100)), closed: value >= goal });

/** Active minutes: the sum of gaps between consecutive events in each session, ignoring idle gaps. */
export function activeMinutes(events: WeekEvent[]): number {
  const bySession = new Map<string, number[]>();
  for (const e of events) {
    const list = bySession.get(e.sessionId) ?? [];
    list.push(e.timestamp);
    bySession.set(e.sessionId, list);
  }
  let ms = 0;
  for (const ts of bySession.values()) {
    ts.sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) ms += Math.min(ts[i] - ts[i - 1], IDLE_GAP_MS);
  }
  return Math.floor(ms / 60_000);
}

/** Each session's lesson (from enter_lab) and whether it was submitted, among the given events. */
export function sessionsIn(events: WeekEvent[]): Map<string, { lessonId: string | null; completed: boolean }> {
  const out = new Map<string, { lessonId: string | null; completed: boolean }>();
  for (const e of events) {
    const s = out.get(e.sessionId) ?? { lessonId: null, completed: false };
    if (e.action === 'enter_lab' && e.target) s.lessonId = e.target;
    if (e.action === 'submit_analysis') s.completed = true;
    out.set(e.sessionId, s);
  }
  return out;
}

/**
 * Ring progress for one student and week. `scores` maps session id to the score stored when its pack was claimed.
 * Lessons count once per week however often they are repeated, so a ring cannot be filled by redoing one easy lab.
 */
export function computeRings(week: string, events: WeekEvent[], scores: Map<string, number | null>, base: RingGoals, level: GoalLevel): RingProgress {
  const goals = goalsForLevel(base, level);
  const completed = new Set<string>();
  const mastered = new Set<string>();
  for (const [sessionId, s] of sessionsIn(events)) {
    if (!s.completed) continue;
    const lesson = s.lessonId ?? sessionId;
    completed.add(lesson);
    const score = scores.get(sessionId);
    if (score !== undefined && score !== null && score >= goals.masteryPercent) mastered.add(lesson);
  }
  const explore = ring(activeMinutes(events), goals.exploreMinutes);
  const master = ring(mastered.size, goals.masterCount);
  const complete = ring(completed.size, goals.completeCount);
  return {
    week,
    level,
    explore,
    master,
    complete,
    allClosed: explore.closed && master.closed && complete.closed,
    completedLessons: [...completed],
    masteredLessons: [...mastered],
  };
}

// ---------- lab progress (for the leave-lab popup) ----------

/**
 * How far through a lab a session is, from the lesson service's internal view of it. Null when the lab kind does not
 * expose step-by-step progress.
 */
export function labProgressPercent(a: Record<string, any> | null): number | null {
  if (!a) return null;
  if (a.submitted) return 100;
  const pct = (done: number, total: number) => (total > 0 ? Math.min(99, Math.round((done / total) * 100)) : null);
  if (a.kind === 'missions' && Array.isArray(a.missionDetail)) {
    const missions = a.missionDetail as { met: boolean; questions: { answered: boolean }[] }[];
    const qs = missions.flatMap((m) => m.questions);
    return pct(missions.filter((m) => m.met).length + qs.filter((q) => q.answered).length, missions.length + qs.length);
  }
  if (a.kind === 'sound' && a.sound) return pct(a.sound.tasks?.length ?? 0, a.sound.total ?? 0);
  if (a.kind === 'motion' && a.motion) return pct(a.motion.trials?.length ?? 0, a.motion.total ?? 0);
  if (a.kind === 'biology' && a.biology) {
    const b = a.biology;
    return pct((b.visited ?? 0) + (b.quiz?.length ?? 0), (b.stops ?? 0) + (b.quizTotal ?? 0));
  }
  if (Array.isArray(a.tubes) && a.tubes.length && a.tubes.every((t: any) => typeof t.open === 'boolean')) {
    return pct(a.tubes.filter((t: any) => !t.open).length, a.tubes.length);
  }
  return null;
}
