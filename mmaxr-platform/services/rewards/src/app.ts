import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { SETS } from './catalog';
import { GOAL_LEVELS, WEEK_KEY_RE, type GoalLevel, type RingGoals } from './rings';
import { HttpError, type Rewards } from './service';

type Role = 'student' | 'instructor';
interface Authed extends Request {
  auth?: { userId: string; role: Role };
}

export function createApp(rewards: Rewards, jwtSecret: string) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  /** The user-auth login token. The student id always comes from here, never from the request body. */
  const requireRole = (role: Role) => (req: Authed, res: Response, next: NextFunction) => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing bearer token' });
    try {
      const claims = jwt.verify(header.slice(7), jwtSecret) as jwt.JwtPayload;
      if (!claims.sub || (claims.role !== 'student' && claims.role !== 'instructor')) throw new Error('bad claims');
      if (claims.role !== role) return res.status(403).json({ error: role === 'instructor' ? 'Instructor access only' : 'Student access only' });
      req.auth = { userId: String(claims.sub), role: claims.role };
      next();
    } catch {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
  const student = requireRole('student');
  const instructor = requireRole('instructor');

  const wrap = (fn: (req: Authed, res: Response) => Promise<unknown>) => (req: Authed, res: Response) => {
    fn(req, res)
      .then((body) => {
        if (!res.headersSent) res.json(body);
      })
      .catch((err) => {
        if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
        console.error(err);
        if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
      });
  };

  const weekParam = (req: Request): string | undefined => {
    const w = req.query.week;
    if (w === undefined) return undefined;
    if (typeof w !== 'string' || !WEEK_KEY_RE.test(w)) throw new HttpError(400, 'week must look like 2026-W48');
    return w;
  };

  const subjects = new Set(SETS.map((s) => s.subject));
  const setIds = new Set(SETS.map((s) => s.set));
  const filterParam = (req: Request) => {
    const subject = typeof req.query.subject === 'string' ? req.query.subject : undefined;
    const set = typeof req.query.set === 'string' ? req.query.set : undefined;
    if (subject && !subjects.has(subject as never)) throw new HttpError(400, `Unknown subject ${subject}`);
    if (set && !setIds.has(set)) throw new HttpError(400, `Unknown set ${set}`);
    return { subject, set };
  };

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // ---------- student ----------

  app.post('/sessions/:sessionId/claim', student, (req: Authed, res) => {
    rewards
      .claim(req.auth!.userId, req.params.sessionId)
      .then((out) => res.status(out.created ? 201 : 200).json(out))
      .catch((err) => {
        if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...err.extra });
        console.error(err);
        res.status(500).json({ error: 'Internal server error' });
      });
  });
  app.get('/sessions/:sessionId/progress', student, wrap((req) => rewards.sessionProgress(req.auth!.userId, req.params.sessionId)));

  app.get('/packs', student, wrap((req) => rewards.listPacks(req.auth!.userId, req.query.unopened === 'true')));
  app.post('/packs/:packId/open', student, wrap((req) => rewards.openPack(req.auth!.userId, req.params.packId)));

  app.get('/collection', student, wrap(async (req) => rewards.collection(req.auth!.userId, filterParam(req))));
  app.get('/cards/:cardId', student, wrap((req) => rewards.card(req.auth!.userId, req.params.cardId)));
  app.post('/shards/upgrade', student, wrap(async (req) => {
    const { cardId } = req.body ?? {};
    if (typeof cardId !== 'string' || !cardId) throw new HttpError(400, 'cardId is required');
    return rewards.upgradeFoil(req.auth!.userId, cardId);
  }));

  app.get('/rings/current', student, wrap(async (req) => rewards.rings(req.auth!.userId, weekParam(req))));
  app.put('/rings/goal-level', student, wrap(async (req) => {
    const { level } = req.body ?? {};
    if (!GOAL_LEVELS.includes(level)) throw new HttpError(400, `level must be one of ${GOAL_LEVELS.join(', ')}`);
    return rewards.setGoalLevel(req.auth!.userId, level as GoalLevel);
  }));

  app.get('/personal-bests', student, wrap((req) => rewards.personalBests(req.auth!.userId)));

  // ---------- instructor ----------

  app.get('/instructor/rings', instructor, wrap(async (req) => rewards.classRings(weekParam(req))));
  app.get('/instructor/students/:studentId/collection', instructor, wrap(async (req) => rewards.collection(req.params.studentId, filterParam(req))));
  app.get('/instructor/ring-goals', instructor, wrap(async () => ({ goals: await rewards.goals() })));
  app.put('/instructor/ring-goals', instructor, wrap(async (req) => {
    const b = req.body ?? {};
    const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
    if (!int(b.exploreMinutes, 1, 1000) || !int(b.masterCount, 1, 50) || !int(b.completeCount, 1, 50) || !int(b.masteryPercent, 1, 100)) {
      throw new HttpError(400, 'Give whole numbers: exploreMinutes 1-1000, masterCount 1-50, completeCount 1-50, masteryPercent 1-100');
    }
    const goals: RingGoals = { exploreMinutes: b.exploreMinutes, masterCount: b.masterCount, completeCount: b.completeCount, masteryPercent: b.masteryPercent };
    return rewards.setGoals(req.auth!.userId, goals);
  }));

  return app;
}
