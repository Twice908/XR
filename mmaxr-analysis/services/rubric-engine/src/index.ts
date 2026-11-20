import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { analyze, parseSensorCsv, type EventRow, type SensorData, type TruthInfo } from './scoring';

const app = express();
app.use(cors());
app.use(express.json());

// Only signed-in instructors (tokens issued by user-auth) may read students, sessions and analyses.
// Set REQUIRE_INSTRUCTOR_AUTH=false to run local scripts without a token.
const JWT_SECRET = process.env.JWT_SECRET || 'mmaxr-dev-secret-change-me';
const REQUIRE_AUTH = process.env.REQUIRE_INSTRUCTOR_AUTH !== 'false';

function requireInstructor(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!REQUIRE_AUTH) return next();
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing bearer token' });
  try {
    const claims = jwt.verify(header.slice(7), JWT_SECRET) as jwt.JwtPayload;
    if (claims.role !== 'instructor') return res.status(403).json({ error: 'Instructor access only' });
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://admin:password@localhost:5432/mmaxr',
});

// The xapi-emitter owns this table; make sure the device column exists even if we start first.
pool
  .query(`ALTER TABLE IF EXISTS xapi_events ADD COLUMN IF NOT EXISTS device VARCHAR(8)`)
  .catch((err) => console.error('device column check failed:', err));

const s3Client = new S3Client({
  region: 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || 'admin',
    secretAccessKey: process.env.S3_SECRET_KEY || 'password',
  },
});

async function getSensorData(sessionId: string): Promise<SensorData | null> {
  try {
    const manifest = await pool.query(`SELECT file_url FROM session_manifests WHERE session_id = $1 ORDER BY id DESC LIMIT 1`, [sessionId]);
    if (manifest.rows.length === 0) return null;
    const key = String(manifest.rows[0].file_url).split('/').pop();
    const obj = await s3Client.send(new GetObjectCommand({ Bucket: 'mmaxr-telemetry', Key: key }));
    const csv = await obj.Body?.transformToString();
    return csv ? parseSensorCsv(csv) : null;
  } catch (err) {
    console.error('Error fetching sensor CSV:', err);
    return null;
  }
}

const LESSON_LOADER_URL = process.env.LESSON_LOADER_URL || 'http://localhost:3007';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'mmaxr-internal-dev';

/** The hidden answers and the locked submission for a chemistry session, from the lesson service. Null if there are none. */
async function getTruth(sessionId: string): Promise<TruthInfo | null> {
  try {
    const res = await fetch(`${LESSON_LOADER_URL}/internal/assignments/${encodeURIComponent(sessionId)}`, { headers: { 'x-internal-key': INTERNAL_KEY } });
    if (!res.ok) return null;
    const a = (await res.json()) as { kind?: string; tubes: TruthInfo['tubes']; submission: { tubes: { tube: number; conclusion: string | null; ph: number | null }[] } | null; biology?: TruthInfo['biology']; optics?: TruthInfo['optics']; motion?: TruthInfo['motion']; reasoning?: TruthInfo['reasoning'] };
    if (a.kind === 'optics') return { tubes: [], submission: null, optics: a.optics };
    if (a.kind === 'motion') return { tubes: [], submission: null, motion: a.motion };
    if (a.kind === 'biology') return { tubes: [], submission: null, biology: a.biology };
    return { tubes: a.tubes ?? [], submission: a.submission ?? null, reasoning: a.reasoning ?? null };
  } catch {
    return null;
  }
}

const SESSION_COLUMNS = `
  session_id,
  MAX(student_id) AS student_id,
  COUNT(*) AS event_count,
  MIN(timestamp) AS started_at,
  MAX(timestamp) AS last_update,
  MAX(device) AS device,
  MAX(CASE WHEN object_data->>'action' = 'enter_lab' THEN object_data->>'target' END) AS lesson_id,
  BOOL_OR(object_data->>'action' IN ('submit_analysis')) AS completed`;

app.get('/health', (_req, res) => res.json({ ok: true }));

// Recent sessions across all students.
app.get('/sessions', requireInstructor, async (_req, res) => {
  try {
    const result = await pool.query(`SELECT ${SESSION_COLUMNS} FROM xapi_events GROUP BY session_id ORDER BY last_update DESC LIMIT 50`);
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch sessions', err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

// One row per student who has any activity: used to decorate the enrolment list.
app.get('/students/summary', requireInstructor, async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT student_id,
             COUNT(DISTINCT session_id) AS sessions,
             COUNT(*) AS events,
             MAX(timestamp) AS last_update,
             BOOL_OR(device = 'web') AS used_web,
             BOOL_OR(device = 'vr') AS used_vr
        FROM xapi_events
       GROUP BY student_id
       ORDER BY last_update DESC`);
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch student summary', err);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

app.get('/students/:studentId/sessions', requireInstructor, async (req, res) => {
  try {
    const result = await pool.query(`SELECT ${SESSION_COLUMNS} FROM xapi_events WHERE student_id = $1 GROUP BY session_id ORDER BY last_update DESC`, [req.params.studentId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Failed to fetch student sessions', err);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

app.get('/analyze/:sessionId', requireInstructor, async (req, res) => {
  const { sessionId } = req.params;
  try {
    const result = await pool.query(
      `SELECT id, verb, object_data, timestamp, device, student_id FROM xapi_events WHERE session_id = $1 ORDER BY timestamp ASC, id ASC`,
      [sessionId],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Session not found' });

    const events: EventRow[] = result.rows.map((r) => ({ id: Number(r.id), verb: r.verb, object_data: r.object_data, timestamp: Number(r.timestamp), device: r.device }));
    const [sensor, truth] = await Promise.all([getSensorData(sessionId), getTruth(sessionId)]);
    const report = analyze(events, sensor, truth);

    // Legacy flat score map, kept for scripts that read `scores.<dimension>`.
    const scores = Object.fromEntries(report.dimensions.map((d) => [d.key, d.score ?? 0]));

    res.json({
      sessionId,
      studentId: result.rows[0].student_id,
      timestamp: new Date().toISOString(),
      ...report,
      scores,
      trace: events,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Analysis failed' });
  }
});

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`📊 Rubric Engine running on http://localhost:${PORT}`);
});
