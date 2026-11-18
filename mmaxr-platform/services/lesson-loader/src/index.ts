import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { createClient } from 'redis';
import { isVerdict, pickSolutions, reactionColor, redactChemistry, verdictOf, type Assignment, type Submission } from './chemistry';

const app = express();
app.use(cors());
app.use(express.json());

const assetsPath = path.join(__dirname, '../../../../mmaxr-assets');
app.use('/assets', express.static(assetsPath));

const SESSION_AUTH_URL = process.env.SESSION_AUTH_URL || 'http://localhost:3004';
const IS_PROD = process.env.NODE_ENV === 'production';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY || 'mmaxr-internal-dev';
if (IS_PROD && INTERNAL_KEY === 'mmaxr-internal-dev') throw new Error('INTERNAL_API_KEY must be set in production');

const redis = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redis.on('error', (err) => console.error('Redis error', err.message));
redis.connect().then(() => console.log('✅ Connected to Redis'));
const ASSIGNMENT_TTL = 86_400;
const key = (sessionId: string) => `assignment:${sessionId}`;

const dataDir = path.join(__dirname, '../data');
const LESSON_ID_RE = /^[a-z0-9-]+$/;

function readLesson(lessonId: string): any | null {
  if (!LESSON_ID_RE.test(lessonId)) return null;
  const file = path.join(dataDir, `${lessonId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function loadAssignment(sessionId: string): Promise<Assignment | null> {
  const raw = await redis.get(key(sessionId));
  return raw ? (JSON.parse(raw) as Assignment) : null;
}
const saveAssignment = (sessionId: string, a: Assignment) => redis.setEx(key(sessionId), ASSIGNMENT_TTL, JSON.stringify(a));

/** Is this bearer token the one session-auth issued for this session? */
async function sessionFor(req: express.Request, sessionId: string): Promise<{ studentId: string; lessonId: string } | null> {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  try {
    const res = await fetch(`${SESSION_AUTH_URL}/auth/verify/${encodeURIComponent(sessionId)}`);
    if (!res.ok) return null;
    const s = (await res.json()) as { token?: string; studentId?: string; lessonId?: string };
    return s.token === token && s.studentId ? { studentId: s.studentId, lessonId: s.lessonId ?? '' } : null;
  } catch {
    return null;
  }
}

const wrap = (fn: (req: express.Request, res: express.Response) => Promise<unknown>) => (req: express.Request, res: express.Response) =>
  fn(req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  });

app.get('/health', (_req, res) => res.json({ ok: true }));

// Catalog of experiments for the experiment picker.
app.get('/lessons', (_req, res) => {
  try {
    const catalog = fs
      .readdirSync(dataDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')))
      .map((l) => ({ lessonId: l.lessonId, type: l.type, title: l.title, subject: l.subject ?? null, summary: l.summary ?? null, durationMinutes: l.durationMinutes ?? null, difficulty: l.difficulty ?? null }));
    res.json(catalog);
  } catch (error) {
    console.error('Error reading lesson catalog:', error);
    res.status(500).json({ error: 'Failed to load lesson catalog' });
  }
});

// Legacy entry point used by the Unity prototype. Defaults to physics unless ?type=chemistry.
// Declared before /lessons/:lessonId so "active" is not read as a lesson id.
app.get('/lessons/active', (req, res) => {
  try {
    const lessonId = req.query.type === 'chemistry' ? 'chemistry-101' : 'physics-101';
    const lesson = readLesson(lessonId);
    if (lesson.type === 'chemistry_indicators') {
      lesson.assignedSolutions = pickSolutions(lesson.solutionPool, lesson.config.totalTestTubes);
      delete lesson.solutionPool;
    }
    res.json(lesson);
  } catch (error) {
    console.error('Error reading lesson data:', error);
    res.status(500).json({ error: 'Failed to load lesson contract' });
  }
});

// One lesson for one session. A chemistry lab is bound to the session here: the random tube assignment is
// drawn and stored server-side, and the browser gets a redacted lesson with no answers in it.
app.get(
  '/lessons/:lessonId',
  wrap(async (req, res) => {
    const lesson = readLesson(req.params.lessonId);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
    if (lesson.type !== 'chemistry_indicators') return res.json(lesson);

    const sessionId = String(req.query.sessionId ?? '');
    if (sessionId) {
      const who = await sessionFor(req, sessionId);
      if (!who) return res.status(401).json({ error: 'Invalid session' });
      if (!(await loadAssignment(sessionId))) {
        const a: Assignment = {
          lessonId: lesson.lessonId,
          studentId: who.studentId,
          tubes: pickSolutions(lesson.solutionPool, lesson.config.totalTestTubes),
          tested: {},
          submission: null,
          createdAt: Date.now(),
        };
        await saveAssignment(sessionId, a);
      }
    }
    res.json(redactChemistry(lesson));
  }),
);

// "What does this tool show on this tube?" The answer is a colour and nothing else.
app.post(
  '/sessions/:sessionId/chemistry/test',
  wrap(async (req, res) => {
    const { sessionId } = req.params;
    if (!(await sessionFor(req, sessionId))) return res.status(401).json({ error: 'Invalid session' });
    const a = await loadAssignment(sessionId);
    if (!a) return res.status(404).json({ error: 'No lab is running for this session' });
    if (a.submission) return res.status(409).json({ error: 'This experiment was already submitted' });

    const tube = Number(req.body?.tube);
    const tool = String(req.body?.tool ?? '');
    if (!Number.isInteger(tube) || tube < 1 || tube > a.tubes.length) return res.status(400).json({ error: 'Unknown test tube' });
    const lesson = readLesson(a.lessonId);
    const k = `${tube}:${tool}`;
    let color: string | null = a.tested[k] ?? null;
    if (!color) {
      color = reactionColor(lesson.indicators, a.tubes[tube - 1], tool);
      if (!color) return res.status(400).json({ error: 'Unknown tool' });
      a.tested[k] = color;
      await saveAssignment(sessionId, a);
    }
    res.json({ tube, tool, color });
  }),
);

// One-shot: locks the student's analysis, then discloses the truth. Calling it again returns the same truth
// but cannot change what was submitted, so peeking early only costs the student their answers.
app.post(
  '/sessions/:sessionId/chemistry/reveal',
  wrap(async (req, res) => {
    const { sessionId } = req.params;
    if (!(await sessionFor(req, sessionId))) return res.status(401).json({ error: 'Invalid session' });
    const a = await loadAssignment(sessionId);
    if (!a) return res.status(404).json({ error: 'No lab is running for this session' });

    if (!a.submission) {
      const raw = Array.isArray(req.body?.tubes) ? req.body.tubes : [];
      const tubes = a.tubes.map((_, i) => {
        const t = raw.find((x: any) => Number(x?.tube) === i + 1) ?? {};
        const ph = typeof t.ph === 'number' && Number.isFinite(t.ph) && t.ph >= 0 && t.ph <= 14 ? t.ph : null;
        const history = Array.isArray(t.conclusionHistory) ? t.conclusionHistory.filter(isVerdict).slice(0, 20) : [];
        return { tube: i + 1, conclusion: isVerdict(t.conclusion) ? t.conclusion : null, ph, conclusionHistory: history };
      });
      a.submission = { tubes, submittedAt: Date.now() } satisfies Submission;
      await saveAssignment(sessionId, a);
    }
    res.json({ tubes: a.tubes.map((s, i) => ({ tube: i + 1, id: s.id, name: s.name, formula: s.formula, type: verdictOf(s.type), ph: s.ph })) });
  }),
);

// Service-to-service: the coach and the rubric engine read the truth here. Never exposed to browsers.
app.get(
  '/internal/assignments/:sessionId',
  wrap(async (req, res) => {
    if (req.headers['x-internal-key'] !== INTERNAL_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const a = await loadAssignment(req.params.sessionId);
    if (!a) return res.status(404).json({ error: 'No assignment for this session' });
    res.json({
      lessonId: a.lessonId,
      studentId: a.studentId,
      submitted: a.submission !== null,
      submission: a.submission,
      tubes: a.tubes.map((s, i) => ({ tube: i + 1, id: s.id, name: s.name, formula: s.formula, type: verdictOf(s.type), ph: s.ph })),
    });
  }),
);

const PORT = process.env.PORT || 3007;
app.listen(PORT, () => {
  console.log(`📚 Lesson Loader running on http://localhost:${PORT}`);
  console.log(`📦 Serving 3D assets from: ${assetsPath}`);
});
