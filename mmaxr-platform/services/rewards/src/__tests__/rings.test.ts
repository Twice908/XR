import { describe, expect, it } from 'vitest';
import { activeMinutes, computeRings, DEFAULT_GOALS, goalsForLevel, labProgressPercent, previousWeek, weekKey, weekRange, type WeekEvent } from '../rings';

describe('weeks', () => {
  it('uses ISO week numbers in the school time zone', () => {
    // Thursday 26 Nov 2026 is in ISO week 48.
    expect(weekKey(Date.UTC(2026, 10, 26, 12), 330)).toBe('2026-W48');
    // Sunday 23:00 UTC is already Monday in India (+5:30): the next week.
    expect(weekKey(Date.UTC(2026, 10, 29, 23), 330)).toBe('2026-W49');
    expect(weekKey(Date.UTC(2026, 10, 29, 23), 0)).toBe('2026-W48');
    // 1 Jan 2027 is a Friday, so it belongs to 2026's last week.
    expect(weekKey(Date.UTC(2027, 0, 1, 12), 0)).toBe('2026-W53');
  });

  it('round-trips a week key through its range', () => {
    for (const key of ['2026-W01', '2026-W48', '2026-W53', '2027-W10']) {
      const { start, end } = weekRange(key, 330);
      expect(end - start).toBe(7 * 86_400_000);
      expect(weekKey(start, 330)).toBe(key);
      expect(weekKey(end - 1, 330)).toBe(key);
      expect(weekKey(end, 330)).not.toBe(key);
    }
    expect(previousWeek('2027-W01')).toBe('2026-W53');
  });
});

const ev = (sessionId: string, minute: number, action: string | null = null, target: string | null = null): WeekEvent => ({ sessionId, timestamp: minute * 60_000, action, target });

describe('rings', () => {
  it('counts active minutes and ignores idle gaps longer than two minutes', () => {
    const events = [ev('a', 0), ev('a', 1), ev('a', 2), ev('a', 30), ev('b', 0), ev('b', 1.5)];
    // a: 1 + 1 + 2 (capped) = 4, b: 1.5 → 5.5 minutes
    expect(activeMinutes(events)).toBe(5);
  });

  it('counts each lesson once a week and masters only at the threshold', () => {
    const events = [
      ev('s1', 0, 'enter_lab', 'atom-builder'), ev('s1', 1, 'submit_analysis'),
      ev('s2', 2, 'enter_lab', 'atom-builder'), ev('s2', 3, 'submit_analysis'),
      ev('s3', 4, 'enter_lab', 'ionic-bonding'), ev('s3', 5, 'submit_analysis'),
      ev('s4', 6, 'enter_lab', 'cell-explorer'), ev('s4', 7, 'leave_lab'),
    ];
    const scores = new Map<string, number | null>([['s1', 60], ['s2', 85], ['s3', 79]]);
    const r = computeRings('2026-W48', events, scores, DEFAULT_GOALS, 'standard');
    expect(r.complete.value).toBe(2);
    expect(r.master.value).toBe(1);
    expect(r.masteredLessons).toEqual(['atom-builder']);
    expect(r.complete.closed).toBe(false);
  });

  it('closes all rings when the goals are met', () => {
    const lessons = ['atom-builder', 'ionic-bonding', 'cell-explorer'];
    const events = lessons.flatMap((l, i) => [
      ev(`s${i}`, i * 100, 'enter_lab', l),
      ...Array.from({ length: 22 }, (_, k) => ev(`s${i}`, i * 100 + k + 1)),
      ev(`s${i}`, i * 100 + 23, 'submit_analysis'),
    ]);
    const scores = new Map<string, number | null>([['s0', 95], ['s1', 90], ['s2', 40]]);
    const r = computeRings('2026-W48', events, scores, DEFAULT_GOALS, 'standard');
    expect(r.explore.value).toBeGreaterThanOrEqual(60);
    expect(r.allClosed).toBe(true);
    expect(r.complete.percent).toBe(100);
  });

  it('scales goals by the chosen level, never below one', () => {
    expect(goalsForLevel(DEFAULT_GOALS, 'light')).toEqual({ exploreMinutes: 30, masterCount: 1, completeCount: 2, masteryPercent: 80 });
    expect(goalsForLevel(DEFAULT_GOALS, 'stretch')).toEqual({ exploreMinutes: 90, masterCount: 3, completeCount: 5, masteryPercent: 80 });
    expect(goalsForLevel({ ...DEFAULT_GOALS, masterCount: 1 }, 'light').masterCount).toBe(1);
  });
});

describe('labProgressPercent', () => {
  it('reads progress from each lab kind', () => {
    expect(labProgressPercent(null)).toBeNull();
    expect(labProgressPercent({ submitted: true })).toBe(100);
    expect(labProgressPercent({ kind: 'missions', submitted: false, missionDetail: [
      { met: true, questions: [{ answered: true }, { answered: false }] },
      { met: false, questions: [{ answered: false }] },
    ] })).toBe(40);
    expect(labProgressPercent({ kind: 'sound', sound: { tasks: [1, 2], total: 8 } })).toBe(25);
    expect(labProgressPercent({ kind: 'biology', biology: { visited: 3, stops: 5, quiz: [1], quizTotal: 5 } })).toBe(40);
    expect(labProgressPercent({ kind: 'optics', tubes: [{ open: false }, { open: true }, { open: true }, { open: true }] })).toBe(25);
    // Never reports 100 until the lab is actually submitted.
    expect(labProgressPercent({ kind: 'sound', sound: { tasks: [1, 2], total: 2 } })).toBe(99);
    expect(labProgressPercent({ kind: 'indicators', tubes: [{ tube: 1 }] })).toBeNull();
  });
});
