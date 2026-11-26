import type express from 'express';
import { rngFor } from './questionEngine';
import * as ms from './missions';

export interface MissionsDeps {
  wrap: (fn: (req: express.Request, res: express.Response) => Promise<unknown>) => (req: express.Request, res: express.Response) => void;
  sessionFor: (req: express.Request, sessionId: string) => Promise<{ studentId: string } | null>;
  readLesson: (id: string) => any;
  load: (sessionId: string) => Promise<ms.MissionsAssignment | null>;
  save: (sessionId: string, a: ms.MissionsAssignment) => Promise<unknown>;
}

/** The lesson for a mission-lab session: goals, answers and hints removed; the session's deal made on first sight. */
export async function missionsLessonFor(d: MissionsDeps, lesson: ms.MissionsLesson, sessionId: string, studentId: string | null) {
  if (sessionId && studentId && !(await d.load(sessionId))) {
    await d.save(sessionId, ms.newAssignment(lesson, studentId, rngFor(sessionId, lesson.lessonId)));
  }
  return ms.redactMissions(lesson);
}

export function registerMissions(app: express.Express, d: MissionsDeps) {
  const ctx = async (req: express.Request, res: express.Response) => {
    const { sessionId } = req.params;
    if (!(await d.sessionFor(req, sessionId))) {
      res.status(401).json({ error: 'Invalid session' });
      return null;
    }
    const a = await d.load(sessionId);
    if (!a) {
      res.status(404).json({ error: 'No mission lab is running for this session' });
      return null;
    }
    return { sessionId, a, lesson: d.readLesson(a.lessonId) as ms.MissionsLesson };
  };
  const fail = (res: express.Response, r: object): r is { error: string; status: number } => {
    if ('error' in r) {
      const f = r as { error: string; status: number };
      res.status(f.status).json({ error: f.error });
      return true;
    }
    return false;
  };

  // Where the student is: lets a reload pick up mid-lab, including questions already unlocked.
  app.get(
    '/sessions/:sessionId/missions',
    d.wrap(async (req, res) => {
      const c = await ctx(req, res);
      if (!c) return;
      const { a, lesson } = c;
      const current = ms.currentMission(lesson, a);
      const open = current && a.progress[current.id]?.metAt != null ? ms.checkMission(lesson, a, current.id, null, Date.now()) : null;
      res.json({ progress: ms.progressOf(lesson, a), questions: open && !('error' in open) ? open.questions : [] });
    }),
  );

  // Check the build against the mission goal. The goal itself is never sent.
  app.post(
    '/sessions/:sessionId/missions/check',
    d.wrap(async (req, res) => {
      const c = await ctx(req, res);
      if (!c) return;
      const { sessionId, a, lesson } = c;
      const r = ms.checkMission(lesson, a, String(req.body?.mission ?? ''), req.body?.state, Date.now());
      if (fail(res, r)) return;
      await d.save(sessionId, a);
      res.json({ ...r, progress: ms.progressOf(lesson, a) });
    }),
  );

  // One more hint, in order: nudge, clue, explanation.
  app.post(
    '/sessions/:sessionId/missions/hint',
    d.wrap(async (req, res) => {
      const c = await ctx(req, res);
      if (!c) return;
      const { sessionId, a, lesson } = c;
      const r = ms.nextHint(lesson, a, String(req.body?.mission ?? ''));
      if (fail(res, r)) return;
      await d.save(sessionId, a);
      res.json(r);
    }),
  );

  // Lock in an answer. Only now is the right option disclosed.
  app.post(
    '/sessions/:sessionId/missions/answer',
    d.wrap(async (req, res) => {
      const c = await ctx(req, res);
      if (!c) return;
      const { sessionId, a, lesson } = c;
      const r = ms.answerQuestion(lesson, a, String(req.body?.question ?? ''), String(req.body?.choice ?? ''), Number(req.body?.thinkMs) || 0, Date.now());
      if (fail(res, r)) return;
      await d.save(sessionId, a);
      res.json({ ...r, progress: ms.progressOf(lesson, a) });
    }),
  );

  app.post(
    '/sessions/:sessionId/missions/finish',
    d.wrap(async (req, res) => {
      const c = await ctx(req, res);
      if (!c) return;
      const { sessionId, a, lesson } = c;
      const r = ms.finish(lesson, a, Date.now());
      if (fail(res, r)) return;
      await d.save(sessionId, a);
      res.json(r);
    }),
  );
}
