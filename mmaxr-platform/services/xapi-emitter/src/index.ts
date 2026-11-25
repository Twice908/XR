import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import { TelemetryEvent } from '@mmaxr/schema';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const SESSION_AUTH_URL = process.env.SESSION_AUTH_URL || 'http://localhost:3004';
// Every event must come with its session's token, and the student id is taken from that session, never from the
// browser. Set XAPI_REQUIRE_SESSION=false only for local scripts that post events without a session.
const REQUIRE_SESSION = process.env.XAPI_REQUIRE_SESSION !== 'false';

// Connect to the Postgres DB we spin up in Docker
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://admin:password@localhost:5432/mmaxr',
});

// Initialize DB table
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS xapi_events (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255),
        student_id VARCHAR(255),
        verb VARCHAR(50),
        object_data JSONB,
        timestamp BIGINT
      );
      ALTER TABLE xapi_events ADD COLUMN IF NOT EXISTS device VARCHAR(8);
      CREATE INDEX IF NOT EXISTS xapi_events_student_idx ON xapi_events (student_id);
      CREATE INDEX IF NOT EXISTS xapi_events_session_idx ON xapi_events (session_id);
    `);
    console.log('✅ Database connected and table ensured.');
  } catch (err) {
    console.error('❌ Database initialization failed:', err);
  }
}
initDB();

interface SessionInfo {
  studentId: string;
  device: 'web' | 'vr';
}

// A lab flushes after almost every event, so remember a checked token for a minute instead of asking each time.
const checked = new Map<string, { info: SessionInfo; until: number }>();

async function sessionFor(sessionId: string, token: string): Promise<SessionInfo | null> {
  const key = `${sessionId}|${token}`;
  const hit = checked.get(key);
  if (hit && hit.until > Date.now()) return hit.info;
  try {
    const res = await fetch(`${SESSION_AUTH_URL}/auth/verify/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const s = (await res.json()) as { studentId?: string; device?: string };
    if (!s.studentId) return null;
    const info: SessionInfo = { studentId: s.studentId, device: s.device === 'vr' ? 'vr' : 'web' };
    if (checked.size > 5000) checked.clear();
    checked.set(key, { info, until: Date.now() + 60_000 });
    return info;
  } catch {
    return null;
  }
}

// The Endpoint the VR client will hit
app.post('/events', async (req, res) => {
  try {
    // Check if the client sent an array of events or a single event
    const events: TelemetryEvent[] = Array.isArray(req.body) ? req.body : req.body?.events ? req.body.events : [req.body];

    if (!events || events.length === 0) {
      return res.status(400).json({ error: 'No events provided' });
    }

    // The token arrives as a bearer header, or inside the body for sendBeacon (which cannot set headers).
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : typeof req.body?.token === 'string' ? req.body.token : '';

    const valid = events.filter((e) => e && e.sessionId && e.verb);
    const sessions = new Map<string, SessionInfo | null>();
    if (REQUIRE_SESSION) {
      if (!token) return res.status(401).json({ error: 'Session token required' });
      for (const id of new Set(valid.map((e) => e.sessionId))) sessions.set(id, await sessionFor(id, token));
      if ([...sessions.values()].some((s) => s === null)) return res.status(401).json({ error: 'Invalid session token' });
    }

    // Loop through and save each event to Postgres
    for (const event of valid) {
      const s = sessions.get(event.sessionId);
      const studentId = s ? s.studentId : event.studentId || 'unknown';
      const device = s ? s.device : event.device === 'web' || event.device === 'vr' ? event.device : null;
      await pool.query(
        `INSERT INTO xapi_events (session_id, student_id, verb, object_data, timestamp, device)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [event.sessionId, studentId, event.verb, event.object || {}, event.timestamp, device]
      );
    }

    console.log(`[DB Insert] ${valid.length} event(s) recorded.`);
    res.status(201).json({ success: true, count: valid.length });
  } catch (err) {
    console.error('DB Insert Error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 xAPI Emitter running on http://localhost:${PORT}`);
});
