import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { createClient } from 'redis';
import { dealQuiz, explanationResults, markAnswer, questionOf, quizFor, redactBiology, secretTerms, wordCount, type BiologyAssignment, type Checkpoint } from './biology';
import { budgetUsed, factsFor, isKind, pickMaterials, redactMetals, runTest as runMetalsTest, visibleSamples, type MetalsAssignment, type MetalsSubmission } from './metals';
import { allTrialsDone, buildReveal, checkExplanation, cleanTable, flatCases, judgeTrial, makePlan, owesExplanation, personalize, redactOptics, stageBlocker, trialKey, truthFor, type OpticsAssignment, type OpticsTrial } from './optics';
import { registerSound, soundInternal, soundLessonFor } from './soundRoutes';
import type { SoundAssignment } from './sound';
import { drawVariants, redactMotion, type MotionAssignment } from './motion';
import { motionInternal, registerMotion } from './motionRoutes';
import { reasoningSummary, registerReasoning } from './reasoningRoutes';
import { rngFor } from './questionEngine';
import { isVerdict, pickSolutions, reactionColor, redactChemistry, verdictOf, type Assignment, type Submission } from './chemistry';

const app = express();
app.use(cors());
app.use(express.json({ limit: '6mb' }));

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
const isBiologyLesson = (l: { type?: string }) => l.type === 'biology_digestive_system' || l.type === 'biology_respiratory_system';
const LESSON_ID_RE = /^[a-z0-9-]+$/;

/**
 * Contracts hardcode http://localhost:3007/assets/<path>. In production the models live on a CDN:
 * ASSET_BASE_URL replaces that prefix; ASSET_OVERRIDES ("file.glb=https://full/url,...") re-points single files
 * (e.g. models over a CDN's per-file size limit).
 */
const ASSET_BASE_URL = (process.env.ASSET_BASE_URL || '').replace(/\/+$/, '');
const ASSET_OVERRIDES = new Map(
  (process.env.ASSET_OVERRIDES || '').split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
    const i = p.indexOf('=');
    return [p.slice(0, i), p.slice(i + 1)] as [string, string];
  }),
);
function rewriteAssetUrls(raw: string): string {
  if (!ASSET_BASE_URL && ASSET_OVERRIDES.size === 0) return raw;
  let out = ASSET_BASE_URL ? raw.split('http://localhost:3007/assets').join(ASSET_BASE_URL) : raw;
  for (const [file, url] of ASSET_OVERRIDES) {
    out = out.replace(new RegExp(`https?://[^"\\s]*/models/${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), url);
  }
  return out;
}

function readLesson(lessonId: string): any | null {
  if (!LESSON_ID_RE.test(lessonId)) return null;
  const file = path.join(dataDir, `${lessonId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(rewriteAssetUrls(fs.readFileSync(file, 'utf8')));
}

async function loadAny(sessionId: string): Promise<(Assignment & { kind?: 'indicators' }) | MetalsAssignment | BiologyAssignment | OpticsAssignment | null> {
  const raw = await redis.get(key(sessionId));
  return raw ? JSON.parse(raw) : null;
}
/** The indicators-lab assignment, or null when the session runs something else. */
async function loadAssignment(sessionId: string): Promise<Assignment | null> {
  const a = await loadAny(sessionId);
  const k = (a as { kind?: string } | null)?.kind;
  return a && k !== 'metals' && k !== 'biology' && k !== 'optics' && k !== 'motion' && k !== 'sound' ? (a as Assignment) : null;
}
async function loadBiology(sessionId: string): Promise<BiologyAssignment | null> {
  const a = await loadAny(sessionId);
  if (!a || (a as BiologyAssignment).kind !== 'biology') return null;
  const bio = a as BiologyAssignment;
  // A session that began before the quiz existed gets a tour and a quiz of its own now.
  if (!bio.quiz) Object.assign(bio, { visited: [], quiz: dealQuiz(readLesson(bio.lessonId), rngFor(sessionId, bio.lessonId)), answers: {} });
  return bio;
}
async function loadMetals(sessionId: string): Promise<MetalsAssignment | null> {
  const a = await loadAny(sessionId);
  return a && (a as MetalsAssignment).kind === 'metals' ? (a as MetalsAssignment) : null;
}
async function loadMotion(sessionId: string): Promise<MotionAssignment | null> {
  const a = await loadAny(sessionId);
  return a && (a as { kind?: string }).kind === 'motion' ? (a as unknown as MotionAssignment) : null;
}
async function loadSound(sessionId: string): Promise<SoundAssignment | null> {
  const a = await loadAny(sessionId);
  return a && (a as { kind?: string }).kind === 'sound' ? (a as unknown as SoundAssignment) : null;
}
async function loadOptics(sessionId: string): Promise<OpticsAssignment | null> {
  const a = await loadAny(sessionId);
  if (!a || (a as OpticsAssignment).kind !== 'optics') return null;
  const op = a as OpticsAssignment;
  // A session started before runs were randomised gets a run of its own now.
  if (!op.plan) op.plan = makePlan(readLesson(op.lessonId), rngFor(sessionId, op.lessonId));
  return op;
}
/** This session's own run of the optics lab: values drawn, everything in its shuffled order. */
const opticsLesson = (a: OpticsAssignment) => personalize(readLesson(a.lessonId), a.plan);
const saveAssignment = (sessionId: string, a: Assignment | MetalsAssignment | BiologyAssignment | OpticsAssignment | MotionAssignment | SoundAssignment) => redis.setEx(key(sessionId), ASSIGNMENT_TTL, JSON.stringify(a));

/** Is this bearer token the one session-auth issued for this session? */
async function sessionFor(req: express.Request, sessionId: string): Promise<{ studentId: string; lessonId: string } | null> {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  try {
    // session-auth checks the token and answers 200 only when it belongs to this session.
    const res = await fetch(`${SESSION_AUTH_URL}/auth/verify/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const s = (await res.json()) as { studentId?: string; lessonId?: string };
    return s.studentId ? { studentId: s.studentId, lessonId: s.lessonId ?? '' } : null;
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
    if (lesson.type === 'chemistry_metals') {
      const sessionId = String(req.query.sessionId ?? '');
      let samples: ReturnType<typeof visibleSamples> | undefined;
      if (sessionId) {
        const who = await sessionFor(req, sessionId);
        if (!who) return res.status(401).json({ error: 'Invalid session' });
        let a = await loadMetals(sessionId);
        if (!a) {
          a = {
            kind: 'metals',
            lessonId: lesson.lessonId,
            studentId: who.studentId,
            samples: pickMaterials(lesson.materialPool, lesson.config.totalSamples, lesson.config.minAnomalies ?? 2, rngFor(sessionId, lesson.lessonId)),
            tested: {},
            submission: null,
            createdAt: Date.now(),
          };
          await saveAssignment(sessionId, a);
        }
        samples = visibleSamples(a.samples);
      }
      return res.json({ ...redactMetals(lesson), ...(samples ? { samples } : {}) });
    }
    if (isBiologyLesson(lesson)) {
      const sessionId = String(req.query.sessionId ?? '');
      if (sessionId) {
        const who = await sessionFor(req, sessionId);
        if (!who) return res.status(401).json({ error: 'Invalid session' });
        if (!(await loadBiology(sessionId))) {
          await saveAssignment(sessionId, { kind: 'biology', lessonId: lesson.lessonId, studentId: who.studentId, visited: [], quiz: dealQuiz(lesson, rngFor(sessionId, lesson.lessonId)), answers: {}, final: null, createdAt: Date.now() });
        }
      }
      return res.json(redactBiology(lesson));
    }
    // the motion sandbox and the magnetism lab share one question engine (variants, locked predictions, explanations)
    if (lesson.type === 'physics_mechanics_sandbox' || lesson.type === 'physics_electromagnetism' || lesson.type === 'physics_circuits' || lesson.type === 'physics_simple_machines' || lesson.type === 'physics_fundamentals_sandbox' || lesson.type === 'science_matter_properties') {
      const sessionId = String(req.query.sessionId ?? '');
      if (sessionId) {
        const who = await sessionFor(req, sessionId);
        if (!who) return res.status(401).json({ error: 'Invalid session' });
        let mo = await loadMotion(sessionId);
        if (!mo) {
          mo = { kind: 'motion', lessonId: lesson.lessonId, studentId: who.studentId, predictions: {}, ...drawVariants(lesson, rngFor(sessionId, lesson.lessonId)), createdAt: Date.now() };
          await saveAssignment(sessionId, mo);
        }
        return res.json(redactMotion(lesson, mo));
      }
      return res.json(redactMotion(lesson));
    }
    if (lesson.type === 'physics_waves_sound') {
      const sessionId = String(req.query.sessionId ?? '');
      let studentId: string | null = null;
      if (sessionId) {
        const who = await sessionFor(req, sessionId);
        if (!who) return res.status(401).json({ error: 'Invalid session' });
        studentId = who.studentId;
      }
      return res.json(await soundLessonFor(soundDeps, lesson, sessionId, studentId));
    }
    if (lesson.type === 'physics_optics') {
      const sessionId = String(req.query.sessionId ?? '');
      if (sessionId) {
        const who = await sessionFor(req, sessionId);
        if (!who) return res.status(401).json({ error: 'Invalid session' });
        let op = await loadOptics(sessionId);
        if (!op) {
          op = { kind: 'optics', lessonId: lesson.lessonId, studentId: who.studentId, plan: makePlan(lesson, rngFor(sessionId, lesson.lessonId)), trials: {}, submission: null, createdAt: Date.now() };
          await saveAssignment(sessionId, op);
        }
        return res.json(redactOptics(opticsLesson(op)));
      }
      return res.json(redactOptics(personalize(lesson, makePlan(lesson))));
    }
    if (lesson.type !== 'chemistry_indicators') return res.json(lesson);

    const sessionId = String(req.query.sessionId ?? '');
    if (sessionId) {
      const who = await sessionFor(req, sessionId);
      if (!who) return res.status(401).json({ error: 'Invalid session' });
      if (!(await loadAssignment(sessionId))) {
        const a: Assignment = {
          lessonId: lesson.lessonId,
          studentId: who.studentId,
          tubes: pickSolutions(lesson.solutionPool, lesson.config.totalTestTubes, rngFor(sessionId, lesson.lessonId)),
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

// ---------------- Metals & Non-Metals ----------------

app.post(
  '/sessions/:sessionId/metals/test',
  wrap(async (req, res) => {
    const { sessionId } = req.params;
    if (!(await sessionFor(req, sessionId))) return res.status(401).json({ error: 'Invalid session' });
    const a = await loadMetals(sessionId);
    if (!a) return res.status(404).json({ error: 'No lab is running for this session' });
    if (a.submission) return res.status(409).json({ error: 'This experiment was already submitted' });

    const slot = Number(req.body?.sample);
    const tool = String(req.body?.tool ?? '');
    if (!Number.isInteger(slot) || slot < 1 || slot > a.samples.length) return res.status(400).json({ error: 'Unknown sample' });
    const lesson = readLesson(a.lessonId);
    if (!lesson.tools.some((t: any) => t.id === tool)) return res.status(400).json({ error: 'Unknown tool' });

    const k = `${slot}:${tool}`;
    const budget = lesson.config.testBudget as number;
    const fresh = !(k in a.tested);
    if (fresh && budgetUsed(a) >= budget) return res.status(409).json({ error: 'The test budget is used up', used: budgetUsed(a), budget });

    const result = runMetalsTest(a.samples[slot - 1], tool);
    if (!result) return res.status(400).json({ error: 'Unknown tool' });
    if (fresh) {
      a.tested[k] = result.litmus ? `${result.outcome}|${result.litmus}` : result.outcome;
      await saveAssignment(sessionId, a);
    }
    res.json({ sample: slot, tool, ...result, used: budgetUsed(a), budget });
  }),
);

app.post(
  '/sessions/:sessionId/metals/reveal',
  wrap(async (req, res) => {
    const { sessionId } = req.params;
    if (!(await sessionFor(req, sessionId))) return res.status(401).json({ error: 'Invalid session' });
    const a = await loadMetals(sessionId);
    if (!a) return res.status(404).json({ error: 'No lab is running for this session' });

    if (!a.submission) {
      const raw = Array.isArray(req.body?.samples) ? req.body.samples : [];
      const samples = a.samples.map((_, i) => {
        const t = raw.find((x: any) => Number(x?.sample) === i + 1) ?? {};
        return {
          sample: i + 1,
          conclusion: isKind(t.conclusion) ? t.conclusion : null,
          hypothesis: isKind(t.hypothesis) ? t.hypothesis : null,
          conclusionHistory: Array.isArray(t.conclusionHistory) ? t.conclusionHistory.filter(isKind).slice(0, 20) : [],
        };
      });
      a.submission = { samples, submittedAt: Date.now() } satisfies MetalsSubmission;
      await saveAssignment(sessionId, a);
    }
    res.json({
      samples: a.samples.map((m, i) => ({
        sample: i + 1,
        id: m.id,
        name: m.name,
        formula: m.formula,
        type: m.trueType,
        anomaly: m.anomalyFlag === true,
        why: m.why ?? '',
        results: m.results,
        oxideLitmus: m.oxideLitmus,
      })),
    });
  }),
);

// ---------------- Light: Reflection & Spherical Mirrors ----------------

const opticsSession = async (req: express.Request, res: express.Response) => {
  const { sessionId } = req.params;
  if (!(await sessionFor(req, sessionId))) {
    res.status(401).json({ error: 'Invalid session' });
    return null;
  }
  const a = await loadOptics(sessionId);
  if (!a) {
    res.status(404).json({ error: 'No optics lab is running for this session' });
    return null;
  }
  return { sessionId, a, lesson: opticsLesson(a) };
};

// Commit a prediction for one surface, ray rule or image, and only then learn what really happens. The first
// prediction is kept for good: asking again returns the same truth but never replaces what was predicted.
app.post(
  '/sessions/:sessionId/optics/trial',
  wrap(async (req, res) => {
    const ctx = await opticsSession(req, res);
    if (!ctx) return;
    const { sessionId, a, lesson } = ctx;
    if (a.submission) return res.status(409).json({ error: 'This experiment was already submitted' });
    const kind = req.body?.kind;
    const id = String(req.body?.id ?? '');
    if (kind !== 'plane' && kind !== 'law' && kind !== 'rule' && kind !== 'case') return res.status(400).json({ error: 'Unknown trial' });
    const blocker = stageBlocker(lesson, a, kind, id);
    if (blocker) return res.status(409).json({ error: blocker });
    const judged = judgeTrial(lesson, kind, id, req.body?.prediction);
    if (!judged) return res.status(400).json({ error: 'Unknown trial or incomplete prediction' });
    const confidence = [1, 2, 3].includes(Number(req.body?.confidence)) ? (Number(req.body.confidence) as 1 | 2 | 3) : null;
    if (!confidence) return res.status(400).json({ error: 'Say how sure you are' });

    const k = trialKey(kind, id);
    if (!a.trials[k]) {
      const now = Date.now();
      const trial: OpticsTrial = { kind, id, prediction: judged.stored, confidence, thinkMs: Math.max(0, Math.min(3_600_000, Number(req.body?.thinkMs) || 0)), at: now, resultAt: now, match: judged.result.match, score: judged.score };
      a.trials[k] = trial;
      await saveAssignment(sessionId, a);
    }
    // Repeat calls are judged on the stored first prediction, not on whatever was sent this time.
    const first = a.trials[k];
    const stable = judgeTrial(lesson, kind, id, first.prediction)!;
    res.json(stable.result);
  }),
);

// The explanation a run owes. It is timed from the moment the result was shown, must draw on this session's own
// numbers, and is kept for the instructor along with how it was given (typed or spoken, pasted, tab left).
app.post(
  '/sessions/:sessionId/optics/explain',
  wrap(async (req, res) => {
    const ctx = await opticsSession(req, res);
    if (!ctx) return;
    const { sessionId, a, lesson } = ctx;
    if (a.submission) return res.status(409).json({ error: 'This experiment was already submitted' });
    const kind = req.body?.kind;
    const id = String(req.body?.id ?? '');
    if (kind !== 'plane' && kind !== 'law' && kind !== 'rule' && kind !== 'case') return res.status(400).json({ error: 'Unknown trial' });
    const r = checkExplanation(lesson, a, kind, id, req.body ?? {}, Date.now());
    if ('error' in r) return res.status(400).json({ error: r.error });
    const t = a.trials[trialKey(kind, id)];
    if (!t.explanation) {
      t.explanation = r.explanation;
      await saveAssignment(sessionId, a);
    }
    res.json({ ok: true, words: t.explanation.words });
  }),
);

// Explain-aloud audio, kept with the session for the instructor.
app.post(
  '/sessions/:sessionId/optics/audio',
  wrap(async (req, res) => {
    const ctx = await opticsSession(req, res);
    if (!ctx) return;
    const { sessionId, a } = ctx;
    const kind = String(req.body?.kind ?? '');
    const id = String(req.body?.id ?? '');
    const b64 = String(req.body?.fileBase64 ?? '');
    const type = String(req.body?.contentType ?? 'audio/webm');
    const t = a.trials[`${kind}:${id}`];
    if (!t?.explanation) return res.status(409).json({ error: 'Explain this run first' });
    if (!/^audio\//.test(type) || b64.length === 0 || b64.length > 5_000_000) return res.status(400).json({ error: 'Invalid audio' });
    const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
    const store = await fetch(`${process.env.OBJECT_STORE_URL || 'http://localhost:3006'}/upload/base64`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || 'mmaxr-internal-dev' },
      body: JSON.stringify({ filename: `optics_${sessionId}_${kind}_${id}.${ext}`, contentType: type, fileBase64: b64 }),
    });
    if (!store.ok) return res.status(502).json({ error: 'Could not store the audio' });
    const data = (await store.json()) as { url?: string };
    t.explanation.audioUrl = data.url;
    await saveAssignment(sessionId, a);
    res.status(201).json({ stored: true });
  }),
);

// One-shot lock-in: stores the student's table, then discloses the textbook answers and the real-world uses.
app.post(
  '/sessions/:sessionId/optics/submit',
  wrap(async (req, res) => {
    const ctx = await opticsSession(req, res);
    if (!ctx) return;
    const { sessionId, a, lesson } = ctx;
    if (owesExplanation(a)) return res.status(409).json({ error: 'Explain every run before locking in your table' });
    if (!allTrialsDone(lesson, a)) return res.status(409).json({ error: 'Run every experiment before locking in your table' });
    if (!a.submission) {
      const notes: Record<string, string> = {};
      for (const c of flatCases(lesson)) {
        const t = String(req.body?.notes?.[c.id] ?? '').trim().slice(0, 600);
        if (t) notes[c.id] = t;
      }
      a.submission = { table: cleanTable(req.body?.table, lesson, a), notes, submittedAt: Date.now() };
      await saveAssignment(sessionId, a);
    }
    res.json(buildReveal(lesson, a));
  }),
);
registerMotion(app, { wrap, sessionFor, readLesson, load: loadMotion, save: saveAssignment });
const soundDeps = { wrap, sessionFor, readLesson, load: loadSound, save: saveAssignment as never };
registerSound(app, soundDeps);
registerReasoning(app, { wrap, sessionFor, load: loadAny as never, save: saveAssignment as never });

// ---------------- Human Digestive System ----------------

const MAX_EXPLANATION = 2000;
const bioSession = async (req: express.Request, res: express.Response) => {
  const { sessionId } = req.params;
  if (!(await sessionFor(req, sessionId))) {
    res.status(401).json({ error: 'Invalid session' });
    return null;
  }
  const a = await loadBiology(sessionId);
  if (!a) {
    res.status(404).json({ error: 'No journey is running for this session' });
    return null;
  }
  return { sessionId, a, lesson: readLesson(a.lessonId) };
};

// The tour is view-only: the student reports each organ they have seen, in order. The quiz opens after the last one.
app.post(
  '/sessions/:sessionId/biology/visit',
  wrap(async (req, res) => {
    const ctx = await bioSession(req, res);
    if (!ctx) return;
    const { sessionId, a, lesson } = ctx;
    const cps: Checkpoint[] = lesson.checkpoints;
    const id = String(req.body?.checkpoint ?? '');
    const index = cps.findIndex((c) => c.id === id);
    if (index < 0) return res.status(400).json({ error: 'Unknown checkpoint' });
    if (!a.visited.includes(id)) {
      if (index !== a.visited.length) return res.status(409).json({ error: 'Follow the journey in order' });
      if (!(a.watched ?? []).includes(id)) return res.status(409).json({ error: 'Watch this stop in action before moving on' });
      a.visited.push(id);
      a.arrivedAt = Date.now();
      await saveAssignment(sessionId, a);
    }
    res.json({ visited: a.visited.length, total: cps.length, quizOpen: a.visited.length === cps.length });
  }),
);

// The student has watched the current stop's animation. It must be the stop they are on, and they must have been there
// for at least a few seconds (the animations run for about 6 s), so a script cannot tick every stop at once.
const MIN_WATCH_MS = 3000;
app.post(
  '/sessions/:sessionId/biology/watched',
  wrap(async (req, res) => {
    const ctx = await bioSession(req, res);
    if (!ctx) return;
    const { sessionId, a, lesson } = ctx;
    const cps: Checkpoint[] = lesson.checkpoints;
    const id = String(req.body?.checkpoint ?? '');
    const index = cps.findIndex((c) => c.id === id);
    if (index < 0) return res.status(400).json({ error: 'Unknown checkpoint' });
    const watched = a.watched ?? [];
    if (!watched.includes(id)) {
      if (index !== a.visited.length) return res.status(409).json({ error: 'Watch the stop you are on' });
      if (Date.now() - (a.arrivedAt ?? a.createdAt) < MIN_WATCH_MS) return res.status(409).json({ error: 'Watch the whole animation first' });
      a.watched = [...watched, id];
      await saveAssignment(sessionId, a);
    }
    res.json({ watched: a.watched?.length ?? watched.length, total: cps.length });
  }),
);

// The questions dealt to this session: wording and options only, in this session's order.
app.get(
  '/sessions/:sessionId/biology/quiz',
  wrap(async (req, res) => {
    const ctx = await bioSession(req, res);
    if (!ctx) return;
    const { a, lesson } = ctx;
    if (a.visited.length < lesson.checkpoints.length) return res.status(409).json({ error: 'Finish the tour first' });
    res.json({ questions: quizFor(lesson, a), answered: Object.keys(a.answers) });
  }),
);

// One question at a time. The answer is locked on first submit; the right answer comes back only now.
app.post(
  '/sessions/:sessionId/biology/quiz/answer',
  wrap(async (req, res) => {
    const ctx = await bioSession(req, res);
    if (!ctx) return;
    const { sessionId, a, lesson } = ctx;
    if (a.visited.length < lesson.checkpoints.length) return res.status(409).json({ error: 'Finish the tour first' });
    const qid = String(req.body?.question ?? '');
    const marked = markAnswer(lesson, a, qid, String(req.body?.choice ?? ''));
    if (!marked) return res.status(400).json({ error: 'Unknown question or option' });
    const prior = a.answers[qid];
    if (!prior) {
      // Questions are asked in the dealt order.
      const next = a.quiz.find((d) => !a.answers[d.qid]);
      if (next?.qid !== qid) return res.status(409).json({ error: 'Answer the questions in order' });
      a.answers[qid] = { qid, choice: marked.choice, correct: marked.correct, thinkMs: Math.max(0, Math.min(3_600_000, Number(req.body?.thinkMs) || 0)), at: Date.now() };
      await saveAssignment(sessionId, a);
    }
    const kept = a.answers[qid];
    const ans = a.quiz.find((d) => d.qid === qid)!;
    res.status(prior ? 200 : 201).json({ correct: kept.correct, answer: marked.answerPos, yourAnswer: `p${ans.order.indexOf(kept.choice)}`, explanation: marked.explanation, answered: Object.keys(a.answers).length, total: a.quiz.length });
  }),
);

// Explain-back audio for the closing explanation, kept with the session for the instructor.
app.post(
  '/sessions/:sessionId/biology/audio',
  wrap(async (req, res) => {
    const ctx = await bioSession(req, res);
    if (!ctx) return;
    const { sessionId, a } = ctx;
    const b64 = String(req.body?.fileBase64 ?? '');
    const type = String(req.body?.contentType ?? 'audio/webm');
    if (!a.final) return res.status(409).json({ error: 'Submit the final explanation first' });
    if (!/^audio\//.test(type) || b64.length === 0 || b64.length > 5_000_000) return res.status(400).json({ error: 'Invalid audio' });
    const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
    const store = await fetch(`${process.env.OBJECT_STORE_URL || 'http://localhost:3006'}/upload/base64`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': process.env.INTERNAL_API_KEY || 'mmaxr-internal-dev' },
      body: JSON.stringify({ filename: `explain_${sessionId}_final.${ext}`, contentType: type, fileBase64: b64 }),
    });
    if (!store.ok) return res.status(502).json({ error: 'Could not store the audio' });
    const data = (await store.json()) as { url?: string };
    a.final.audioUrl = data.url;
    await saveAssignment(sessionId, a);
    res.status(201).json({ stored: true });
  }),
);

// The closing explanation. One shot, after the tour and the quiz; scored on key-idea coverage.
app.post(
  '/sessions/:sessionId/biology/final',
  wrap(async (req, res) => {
    const ctx = await bioSession(req, res);
    if (!ctx) return;
    const { sessionId, a, lesson } = ctx;
    if (a.visited.length < lesson.checkpoints.length) return res.status(409).json({ error: 'Finish the tour first' });
    if (a.quiz.some((d) => !a.answers[d.qid])) return res.status(409).json({ error: 'Answer the quiz first' });
    const fe = lesson.finalExplain as { prompt: string; minWords?: number; expectedKeywords: string[]; keywordSynonyms?: Record<string, string[]>; modelAnswer?: string } | undefined;
    if (!a.final) {
      let explain;
      if (fe) {
        const text = String(req.body?.explanation ?? '').trim().slice(0, MAX_EXPLANATION);
        if (wordCount(text) < (fe.minWords ?? 20)) return res.status(400).json({ error: `Explain the whole pathway in at least ${fe.minWords ?? 20} words` });
        const kw = explanationResults(text, fe.expectedKeywords, fe.keywordSynonyms);
        explain = { text, coverage: kw.coverage, matched: kw.matched, missed: kw.missed, listLike: kw.listLike, inputMode: req.body?.inputMode === 'voice' ? ('voice' as const) : ('typed' as const), speakMs: Math.max(0, Math.min(600_000, Number(req.body?.speakMs) || 0)) };
      }
      a.final = { correct: a.quiz.filter((d) => a.answers[d.qid]?.correct).length, total: a.quiz.length, submittedAt: Date.now(), ...(explain ? { explain } : {}) };
      await saveAssignment(sessionId, a);
    }
    const ex = a.final.explain;
    res.json({
      correct: a.final.correct,
      total: a.final.total,
      ...(ex && fe ? { explain: { coverage: ex.coverage, listLike: ex.listLike ?? false, keywords: [...ex.matched.map((k) => ({ keyword: k, matched: true })), ...ex.missed.map((k) => ({ keyword: k, matched: false }))], modelAnswer: fe.modelAnswer ?? '' } } : {}),
    });
  }),
);

// Service-to-service: the coach and the rubric engine read the truth here. Never exposed to browsers.
app.get(
  '/internal/assignments/:sessionId',
  wrap(async (req, res) => {
    if (req.headers['x-internal-key'] !== INTERNAL_KEY) return res.status(401).json({ error: 'Unauthorized' });
    const so = await loadSound(req.params.sessionId);
    if (so) return res.json(soundInternal(so, readLesson(so.lessonId)));
    const mo = await loadMotion(req.params.sessionId);
    if (mo) return res.json(motionInternal(mo, readLesson(mo.lessonId)));
    const op = await loadOptics(req.params.sessionId);
    if (op) {
      const lesson = opticsLesson(op);
      const items = [
        ...lesson.planeMirror.scenarios.map((x: any) => ({ id: x.id, name: x.name, facts: x.explanation, terms: [lesson.planeMirror.predictionOptions.find((o: any) => o.id === x.result)?.label ?? ''].filter(Boolean), open: !op.trials[trialKey('plane', x.id)] })),
        ...lesson.lawsOfReflection.laws.map((x: any) => ({ id: x.id, name: x.topic, facts: x.explanation, terms: [x.options.find((o: any) => o.id === x.answer)?.label ?? ''].filter((t: string) => t.length > 6), open: !op.trials[trialKey('law', x.id)] })),
        ...lesson.rayRules.rules.map((x: any) => ({ id: x.id, name: x.incident, facts: x.explanation, terms: [lesson.rayRules.outcomes.find((o: any) => o.id === x.reflected)?.label ?? ''].filter(Boolean), open: !op.trials[trialKey('rule', x.id)] })),
        ...flatCases(lesson).map((x) => ({ id: x.id, name: `${x.mirror} mirror, object ${x.objectPosition}`, facts: `${x.expected.position}, ${x.expected.size}, ${x.expected.nature}, ${x.expected.orientation}. ${x.anomalyExplanation}`.trim(), terms: [x.expected.position], open: !op.trials[trialKey('case', x.id)] })),
      ];
      return res.json({
        kind: 'optics',
        lessonId: op.lessonId,
        studentId: op.studentId,
        submitted: op.submission !== null,
        submission: null,
        tubes: items.map((x, i) => ({ tube: i + 1, id: x.id, name: x.name, formula: '', type: '', ph: 0, facts: x.facts, terms: x.terms, open: x.open })),
        optics: truthFor(lesson, op),
      });
    }
    const bio = await loadBiology(req.params.sessionId);
    if (bio) {
      const lesson = readLesson(bio.lessonId);
      const cps: Checkpoint[] = lesson.checkpoints;
      const dealt = bio.quiz.flatMap((d) => {
        const q = questionOf(lesson, d);
        const cp = cps.find((c) => c.id === d.cp);
        return q && cp ? [{ d, q, cp }] : [];
      });
      return res.json({
        kind: 'biology',
        lessonId: bio.lessonId,
        studentId: bio.studentId,
        submitted: bio.final !== null,
        submission: null,
        // For the coach's guard: each dealt question, with whether the student has answered it yet.
        tubes: dealt.map(({ d, q, cp }, i) => ({ tube: i + 1, id: q.id, name: cp.organName, formula: '', type: '', ph: 0, facts: q.explanation, terms: secretTerms(q), open: !bio.answers[d.qid] })),
        biology: {
          visited: bio.visited.length,
          stops: cps.length,
          quiz: dealt.flatMap(({ d, cp }) => { const k = bio.answers[d.qid]; return k ? [{ id: d.qid, organ: cp.id, correct: k.correct, thinkMs: k.thinkMs }] : []; }),
          quizTotal: bio.quiz.length,
          final: bio.final && { correct: bio.final.correct, total: bio.final.total, explainCoverage: bio.final.explain?.coverage ?? null, inputMode: bio.final.explain?.inputMode ?? null, speakMs: bio.final.explain?.speakMs ?? 0 },
        },
      });
    }
    const m = await loadMetals(req.params.sessionId);
    if (m) {
      return res.json({
        kind: 'metals',
        lessonId: m.lessonId,
        studentId: m.studentId,
        submitted: m.submission !== null,
        submission: m.submission && { tubes: m.submission.samples.map((s) => ({ tube: s.sample, conclusion: s.conclusion, ph: null, hypothesis: s.hypothesis })) },
        reasoning: reasoningSummary(m as never),
        tubes: m.samples.map((x, i) => ({ tube: i + 1, id: x.id, name: x.name, formula: x.formula, type: x.trueType, ph: 0, facts: factsFor(x) })),
      });
    }
    const a = await loadAssignment(req.params.sessionId);
    if (!a) return res.status(404).json({ error: 'No assignment for this session' });
    res.json({
      kind: 'indicators',
      lessonId: a.lessonId,
      studentId: a.studentId,
      submitted: a.submission !== null,
      submission: a.submission,
      reasoning: reasoningSummary(a as never),
      tubes: a.tubes.map((s, i) => ({ tube: i + 1, id: s.id, name: s.name, formula: s.formula, type: verdictOf(s.type), ph: s.ph })),
    });
  }),
);

const PORT = process.env.PORT || 3007;
app.listen(PORT, () => {
  console.log(`📚 Lesson Loader running on http://localhost:${PORT}`);
  console.log(`📦 Serving 3D assets from: ${assetsPath}`);
});
