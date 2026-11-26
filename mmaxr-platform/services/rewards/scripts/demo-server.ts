/**
 * Local demo of the rewards service for frontend work: the real service code on an in-process Postgres (PGlite),
 * seeded with a demo student, a few finished labs and unopened packs. Nothing else from the backend is needed.
 *
 *   pnpm --filter ./mmaxr-platform/services/rewards demo
 *
 * It prints a student token. In the web client's browser console run the printed line to sign in as the demo
 * student, then reload. Point the client at it with VITE_REWARDS_URL=http://localhost:3009 (the default).
 *
 * DEMO ONLY: it also accepts POST /events like the xapi-emitter (student taken from the bearer token, no session
 * check), so a lab finished against VITE_TELEMETRY_URL=http://localhost:3009/events can claim a pack end to end.
 * Data lives in memory and is gone when it stops.
 */
import { PGlite } from '@electric-sql/pglite';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createApp } from '../src/app';
import { initSchema, type Db } from '../src/db';
import { Rewards } from '../src/service';

const SECRET = process.env.JWT_SECRET || 'mmaxr-dev-secret-change-me';
const PORT = Number(process.env.PORT || 3009);
const STUDENT = 'demo-student-0000-0000-000000000001';

async function main() {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE xapi_events (id SERIAL PRIMARY KEY, session_id VARCHAR(255), student_id VARCHAR(255), verb VARCHAR(50), object_data JSONB, timestamp BIGINT, device VARCHAR(8));`);
  const db: Db = {
    query: (sql, params) => pg.query(sql, params) as never,
    exec: async (sql) => {
      await pg.exec(sql);
    },
    tx: (fn) => pg.transaction((t) => fn({ query: (sql, params) => t.query(sql, params) as never })),
  };
  await initSchema(db);

  // Scores for demo sessions: ids ending in "-hi" score 95, "-mid" 82, everything else 70.
  const scoreOf = (id: string) => (id.endsWith('-hi') ? 95 : id.endsWith('-mid') ? 82 : 70);
  const rewards = new Rewards(db, { score: async (id) => scoreOf(id), assignment: async () => ({ kind: 'missions', submitted: false, missionDetail: [{ met: true, questions: [{ answered: true }, { answered: true }] }, { met: false, questions: [{ answered: false }] }] }) });

  const insertEvent = (sessionId: string, student: string, action: string, target: string | null, ts: number) =>
    pg.query(`INSERT INTO xapi_events (session_id, student_id, verb, object_data, timestamp, device) VALUES ($1, $2, 'interacted', $3::jsonb, $4, 'web')`, [sessionId, student, JSON.stringify({ action, target }), ts]);

  // Three finished labs earlier today, each claimed, so the demo student starts with unopened packs.
  const now = Date.now();
  const seeded: [string, string][] = [['demo-atom-hi', 'atom-builder'], ['demo-ionic-mid', 'ionic-bonding'], ['demo-cell', 'cell-explorer']];
  for (const [i, [sessionId, lesson]] of seeded.entries()) {
    const start = now - (3 - i) * 3_600_000;
    await insertEvent(sessionId, STUDENT, 'enter_lab', lesson, start);
    for (let m = 1; m <= 15; m++) await insertEvent(sessionId, STUDENT, 'step', null, start + m * 60_000);
    await insertEvent(sessionId, STUDENT, 'submit_analysis', null, start + 16 * 60_000);
    await rewards.claim(STUDENT, sessionId);
  }

  const app = createApp(rewards, SECRET);
  // Demo-only stand-in for the xapi-emitter.
  const events = express.Router();
  events.use(express.json({ limit: '2mb' }));
  events.post('/events', async (req, res) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : String(req.body?.token ?? '');
    let student = STUDENT;
    try {
      student = String((jwt.verify(token, SECRET) as jwt.JwtPayload).sub);
    } catch {
      /* session tokens are not JWTs: fall back to the demo student */
    }
    const list = Array.isArray(req.body) ? req.body : req.body?.events ?? [req.body];
    for (const e of list) if (e?.sessionId) await insertEvent(e.sessionId, student, e.object?.action ?? null, e.object?.target ?? null, e.timestamp ?? Date.now());
    res.status(201).json({ success: true, count: list.length });
  });
  app.use(events);

  app.listen(PORT, () => {
    const token = jwt.sign({ sub: STUDENT, role: 'student', username: 'demo' }, SECRET, { expiresIn: '7d' });
    const account = { token, user: { id: STUDENT, username: 'demo', email: null, role: 'student', createdAt: new Date().toISOString() } };
    console.log(`🃏 Rewards demo on http://localhost:${PORT} (3 unopened packs seeded)`);
    console.log('Sign in as the demo student: paste this in the web client console, then reload:');
    console.log(`localStorage.setItem('mmaxr.student.auth', ${JSON.stringify(JSON.stringify(account))})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
