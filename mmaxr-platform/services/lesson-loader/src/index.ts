import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { createClient } from 'redis';
import { cleanSelection, groupsOf, keywordResults, redactBiology, revealFor, scoreFinal, scoreSelection, secretTerms, wordCount, type BiologyAssignment, type Checkpoint, type Commit, type Scenario } from './biology';
import { budgetUsed, factsFor, isKind, pickMaterials, redactMetals, runTest as runMetalsTest, visibleSamples, type MetalsAssignment, type MetalsSubmission } from './metals';
import { allTrialsDone, buildReveal, checkExplanation, cleanTable, flatCases, judgeTrial, makePlan, owesExplanation, personalize, redactOptics, stageBlocker, trialKey, truthFor, type OpticsAssignment, type OpticsTrial } from './optics';
import { registerSound, soundInternal, soundLessonFor } from './soundRoutes';
import type { SoundAssignment } from './sound';
import { drawVariants, redactMotion, type MotionAssignment } from './motion';
import { motionInternal, registerMotion } from './motionRoutes';
import { reasoningSummary, registerReasoning } from './reasoningRoutes';
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

function readLesson(lessonId: string): any | null {
  if (!LESSON_ID_RE.test(lessonId)) return null;
  const file = path.join(dataDir, `${lessonId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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
  return a && (a as BiologyAssignment).kind === 'biology' ? (a as BiologyAssignment) : null;
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
  if (!op.plan) op.plan = makePlan(readLesson(op.lessonId));
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
            samples: pickMaterials(lesson.materialPool, lesson.config.totalSamples, lesson.config.minAnomalies ?? 2),
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
          await saveAssignment(sessionId, { kind: 'biology', lessonId: lesson.lessonId, studentId: who.studentId, commits: {}, final: null, createdAt: Date.now() });
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
          mo = { kind: 'motion', lessonId: lesson.lessonId, studentId: who.studentId, predictions: {}, ...drawVariants(lesson), createdAt: Date.now() };
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
          op = { kind: 'optics', lessonId: lesson.lessonId, studentId: who.studentId, plan: makePlan(lesson), trials: {}, submission: null, createdAt: Date.now() };
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
      headers: { 'Content-Type': 'application/json' },
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

// Commit the student's prediction and explanation for the next checkpoint. Only then is it revealed.
app.post(
  '/sessions/:sessionId/biology/commit',
  wrap(async (req, res) => {
    const ctx = await bioSession(req, res);
    if (!ctx) return;
    const { sessionId, a, lesson } = ctx;
    const cps: Checkpoint[] = lesson.checkpoints;
    const id = String(req.body?.checkpoint ?? '');
    const index = cps.findIndex((c) => c.id === id);
    if (index < 0) return res.status(400).json({ error: 'Unknown checkpoint' });
    if (a.commits[id]) return res.status(409).json({ error: 'This checkpoint is already answered', reveal: revealFor(cps[index], a.commits[id], lesson.choices, groupsOf(lesson)) });
    if (index !== Object.keys(a.commits).length) return res.status(409).json({ error: 'Follow the journey in order' });

    const selection = cleanSelection(req.body?.selection, lesson.choices, groupsOf(lesson));
    if (!selection) return res.status(400).json({ error: 'Choose at least one option in every group (or "none")' });
    const explanation = String(req.body?.explanation ?? '').trim().slice(0, MAX_EXPLANATION);
    const minWords = lesson.config.minExplanationWords ?? 8;
    if (wordCount(explanation) < minWords) return res.status(400).json({ error: `Explain it in at least ${minWords} words` });
    const confidence = [1, 2, 3].includes(Number(req.body?.confidence)) ? (Number(req.body.confidence) as 1 | 2 | 3) : null;
    if (!confidence) return res.status(400).json({ error: 'Say how sure you are' });

    const cp = cps[index];
    const kw = keywordResults(explanation, cp.expectedKeywords, cp.keywordSynonyms);
    const commit: Commit = {
      checkpoint: id,
      n: index + 1,
      selection,
      explanation,
      confidence,
      inputMode: req.body?.inputMode === 'voice' ? 'voice' : 'typed',
      thinkMs: Math.max(0, Math.min(3_600_000, Number(req.body?.thinkMs) || 0)),
      speakMs: Math.max(0, Math.min(600_000, Number(req.body?.speakMs) || 0)),
      committedAt: Date.now(),
      selectionScore: scoreSelection(cp, selection, groupsOf(lesson)),
      coverage: kw.coverage,
      matched: kw.matched,
      missed: kw.missed,
      revisions: [],
    };
    a.commits[id] = commit;
    await saveAssignment(sessionId, a);
    res.status(201).json({ reveal: revealFor(cp, commit, lesson.choices, groupsOf(lesson)) });
  }),
);

// Improve the explanation after the reveal. Counted as a revision; the first attempt is never overwritten.
app.post(
  '/sessions/:sessionId/biology/revise',
  wrap(async (req, res) => {
    const ctx = await bioSession(req, res);
    if (!ctx) return;
    const { sessionId, a, lesson } = ctx;
    const id = String(req.body?.checkpoint ?? '');
    const commit = a.commits[id];
    if (!commit) return res.status(409).json({ error: 'Answer this checkpoint first' });
    if (a.final) return res.status(409).json({ error: 'The journey is already finished' });
    if (commit.revisions.length >= (lesson.config.maxRevisions ?? 3)) return res.status(409).json({ error: 'No more revisions for this checkpoint' });
    const text = String(req.body?.explanation ?? '').trim().slice(0, MAX_EXPLANATION);
    if (wordCount(text) < (lesson.config.minExplanationWords ?? 8)) return res.status(400).json({ error: 'Write a little more' });
    const cp: Checkpoint = lesson.checkpoints.find((c: Checkpoint) => c.id === id);
    const kw = keywordResults(text, cp.expectedKeywords, cp.keywordSynonyms);
    commit.revisions.push({ text, coverage: kw.coverage, at: Date.now() });
    await saveAssignment(sessionId, a);
    res.json({ coverage: kw.coverage, keywords: kw.results, revisions: commit.revisions.length, maxRevisions: lesson.config.maxRevisions ?? 3 });
  }),
);

// Explain-back audio, kept with the session for the instructor.
app.post(
  '/sessions/:sessionId/biology/audio',
  wrap(async (req, res) => {
    const ctx = await bioSession(req, res);
    if (!ctx) return;
    const { sessionId, a } = ctx;
    const id = String(req.body?.checkpoint ?? '');
    const b64 = String(req.body?.fileBase64 ?? '');
    const type = String(req.body?.contentType ?? 'audio/webm');
    const isFinal = id === 'final' && a.final;
    if (!a.commits[id] && !isFinal) return res.status(409).json({ error: 'Answer this checkpoint first' });
    if (!/^audio\//.test(type) || b64.length === 0 || b64.length > 5_000_000) return res.status(400).json({ error: 'Invalid audio' });
    const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
    const store = await fetch(`${process.env.OBJECT_STORE_URL || 'http://localhost:3006'}/upload/base64`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: `explain_${sessionId}_${id}.${ext}`, contentType: type, fileBase64: b64 }),
    });
    if (!store.ok) return res.status(502).json({ error: 'Could not store the audio' });
    const data = (await store.json()) as { url?: string };
    if (isFinal) {
      if (a.final?.explain) (a.final.explain as { audioUrl?: string }).audioUrl = data.url;
    } else a.commits[id].audioUrl = data.url;
    await saveAssignment(sessionId, a);
    res.status(201).json({ stored: true });
  }),
);

// The "what if" challenge. One shot, after the whole journey.
app.post(
  '/sessions/:sessionId/biology/final',
  wrap(async (req, res) => {
    const ctx = await bioSession(req, res);
    if (!ctx) return;
    const { sessionId, a, lesson } = ctx;
    const scenarios: Scenario[] = lesson.transfer.scenarios;
    if (Object.keys(a.commits).length < lesson.checkpoints.length) return res.status(409).json({ error: 'Finish the journey first' });
    const fe = lesson.finalExplain as { prompt: string; minWords?: number; expectedKeywords: string[]; keywordSynonyms?: Record<string, string[]>; modelAnswer?: string } | undefined;
    if (!a.final) {
      const answers: Record<string, string> = {};
      for (const s of scenarios) answers[s.id] = String(req.body?.answers?.[s.id] ?? '');
      const r = scoreFinal(scenarios, answers);
      let explain;
      if (fe) {
        const text = String(req.body?.explanation ?? '').trim().slice(0, MAX_EXPLANATION);
        if (wordCount(text) < (fe.minWords ?? 20)) return res.status(400).json({ error: `Explain the whole pathway in at least ${fe.minWords ?? 20} words` });
        const kw = keywordResults(text, fe.expectedKeywords, fe.keywordSynonyms);
        explain = { text, coverage: kw.coverage, matched: kw.matched, missed: kw.missed, inputMode: req.body?.inputMode === 'voice' ? ('voice' as const) : ('typed' as const), speakMs: Math.max(0, Math.min(600_000, Number(req.body?.speakMs) || 0)) };
      }
      a.final = { answers, results: r.results, correct: r.correct, total: r.total, submittedAt: Date.now(), ...(explain ? { explain } : {}) };
      await saveAssignment(sessionId, a);
    }
    const ex = a.final.explain;
    res.json({
      correct: a.final.correct,
      total: a.final.total,
      results: scenarios.map((s) => ({ id: s.id, correct: a.final!.results.find((r) => r.id === s.id)?.correct ?? false, answer: s.answer, yourAnswer: a.final!.answers[s.id], explanation: s.explanation })),
      ...(ex && fe ? { explain: { coverage: ex.coverage, keywords: [...ex.matched.map((k) => ({ keyword: k, matched: true })), ...ex.missed.map((k) => ({ keyword: k, matched: false }))], modelAnswer: fe.modelAnswer ?? '' } } : {}),
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
      return res.json({
        kind: 'biology',
        lessonId: bio.lessonId,
        studentId: bio.studentId,
        submitted: bio.final !== null,
        submission: null,
        // For the coach's guard: every checkpoint, with whether its answer has already been revealed to the student.
        tubes: cps.map((c, i) => ({ tube: i + 1, id: c.id, name: c.organName, formula: '', type: '', ph: 0, facts: c.revealExplanation, terms: secretTerms(c), open: !bio.commits[c.id] })),
        biology: {
          checkpoints: cps.map((c, i) => {
            const k = bio.commits[c.id];
            return k && { id: c.id, n: i + 1, selection: k.selectionScore, coverageFirst: k.coverage, coverageFinal: k.revisions.length ? Math.max(k.coverage, ...k.revisions.map((r) => r.coverage)) : k.coverage, revisions: k.revisions.length, inputMode: k.inputMode, speakMs: k.speakMs, thinkMs: k.thinkMs };
          }).filter(Boolean),
          final: bio.final && { correct: bio.final.correct, total: bio.final.total, explainCoverage: bio.final.explain?.coverage ?? null },
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
