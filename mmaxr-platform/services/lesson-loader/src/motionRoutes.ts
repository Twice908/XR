import type express from 'express';
import { wordCount } from './biology';
import { allTrials, cleanPrediction, observeFor, scoreExplanation, scorePrediction, secretsOf, type MotionAssignment, type MotionScenario, type MotionTrial } from './motion';

export interface MotionDeps {
  wrap: (fn: (req: express.Request, res: express.Response) => Promise<unknown>) => (req: express.Request, res: express.Response) => void;
  sessionFor: (req: express.Request, sessionId: string) => Promise<{ studentId: string } | null>;
  readLesson: (id: string) => any;
  load: (sessionId: string) => Promise<MotionAssignment | null>;
  save: (sessionId: string, a: MotionAssignment) => Promise<unknown>;
}

const MAX_TEXT = 2000;

/** The trials of a scenario, in order. The student must finish one before the next in the same module. */
function priorsDone(a: MotionAssignment, scenario: MotionScenario, trial: MotionTrial): boolean {
  const i = scenario.trials.findIndex((t) => t.id === trial.id);
  return scenario.trials.slice(0, i).every((t) => a.predictions[t.id]?.match !== null && a.predictions[t.id] !== undefined && finished(t, a.predictions[t.id]));
}
const finished = (t: MotionTrial, p: MotionPrediction | undefined) => !!p && p.match !== null && (!(t.anomaly && t.expectedKeywords?.length) || !!p.explanation);
type MotionPrediction = MotionAssignment['predictions'][string];

export function registerMotion(app: express.Express, d: MotionDeps) {
  const ctx = async (req: express.Request, res: express.Response) => {
    const { sessionId } = req.params;
    if (!(await d.sessionFor(req, sessionId))) {
      res.status(401).json({ error: 'Invalid session' });
      return null;
    }
    const a = await d.load(sessionId);
    if (!a) {
      res.status(404).json({ error: 'No lab is running for this session' });
      return null;
    }
    const lesson = d.readLesson(a.lessonId);
    const trialId = String(req.body?.trial ?? '');
    const scenario = (lesson.scenarios as MotionScenario[]).find((s) => s.trials.some((t) => t.id === trialId));
    const trial = scenario?.trials.find((t) => t.id === trialId);
    if (!scenario || !trial) {
      res.status(400).json({ error: 'Unknown trial' });
      return null;
    }
    return { sessionId, a, lesson, scenario, trial };
  };

  // Lock a prediction. After this the student may watch the result; the prediction can never change.
  app.post(
    '/sessions/:sessionId/motion/predict',
    d.wrap(async (req, res) => {
      const c = await ctx(req, res);
      if (!c) return;
      const { a, scenario, trial } = c;
      if (a.predictions[trial.id]) return res.status(409).json({ error: 'You already locked a prediction for this one' });
      if (!priorsDone(a, scenario, trial)) return res.status(409).json({ error: 'Finish the earlier questions in this module first' });
      const value = cleanPrediction(trial, req.body?.value);
      if (!value) return res.status(400).json({ error: 'Fill in your prediction' });
      const confidence = [1, 2, 3].includes(Number(req.body?.confidence)) ? (Number(req.body.confidence) as 1 | 2 | 3) : null;
      if (!confidence) return res.status(400).json({ error: 'Say how sure you are' });
      const scored = scorePrediction(trial, value);
      a.predictions[trial.id] = { trial: trial.id, value, confidence, thinkMs: Math.max(0, Math.min(3_600_000, Number(req.body?.thinkMs) || 0)), at: Date.now(), match: null, fieldMatch: null };
      // The score is kept server-side until the student has watched the result.
      (a.predictions[trial.id] as any)._pending = scored;
      await d.save(c.sessionId, a);
      res.status(201).json({ locked: true });
    }),
  );

  // The student has watched the result. Now the outcome, and whether the prediction matched, is theirs.
  app.post(
    '/sessions/:sessionId/motion/observe',
    d.wrap(async (req, res) => {
      const c = await ctx(req, res);
      if (!c) return;
      const { a, trial } = c;
      const p = a.predictions[trial.id];
      if (!p) return res.status(409).json({ error: 'Lock a prediction first' });
      if (p.match === null) {
        const pending = (p as any)._pending ?? scorePrediction(trial, p.value);
        p.match = pending.match;
        p.fieldMatch = pending.fieldMatch;
        delete (p as any)._pending;
        await d.save(c.sessionId, a);
      }
      res.json(observeFor(trial, p));
    }),
  );

  // An explanation of the surprising result, scored against the key ideas. One shot: no peeking, then rewriting.
  app.post(
    '/sessions/:sessionId/motion/explain',
    d.wrap(async (req, res) => {
      const c = await ctx(req, res);
      if (!c) return;
      const { a, trial, lesson } = c;
      const p = a.predictions[trial.id];
      if (!p || p.match === null) return res.status(409).json({ error: 'Watch the result first' });
      if (!(trial.anomaly && trial.expectedKeywords?.length)) return res.status(400).json({ error: 'This one needs no explanation' });
      if (p.explanation) return res.status(409).json({ error: 'You already explained this one', keywords: [...p.explanation.matched.map((k) => ({ keyword: k, matched: true })), ...p.explanation.missed.map((k) => ({ keyword: k, matched: false }))], coverage: p.explanation.coverage, explanation: trial.explanation });
      const text = String(req.body?.explanation ?? '').trim().slice(0, MAX_TEXT);
      const min = lesson.config?.minExplanationWords ?? 6;
      if (wordCount(text) < min) return res.status(400).json({ error: `Explain it in at least ${min} words` });
      const s = scoreExplanation(trial, text);
      p.explanation = { text, coverage: s.coverage, matched: s.matched, missed: s.missed, words: s.words, at: Date.now() };
      await d.save(c.sessionId, a);
      res.json({ keywords: s.results, coverage: s.coverage, explanation: trial.explanation });
    }),
  );
}

/** Truth for the coach's guard and the rubric engine. Open trials are the ones whose result is still hidden. */
export function motionInternal(a: MotionAssignment, lesson: { scenarios: MotionScenario[] }) {
  const trials = allTrials(lesson);
  return {
    kind: 'motion',
    lessonId: a.lessonId,
    studentId: a.studentId,
    submitted: trials.every((t) => finished(t, a.predictions[t.id])),
    submission: null,
    tubes: trials.map((t, i) => ({ tube: i + 1, id: t.id, name: t.id, formula: '', type: '', ph: 0, facts: t.explanation, terms: secretsOf(t), open: a.predictions[t.id]?.match == null })),
    motion: {
      trials: trials.map((t, i) => {
        const p = a.predictions[t.id];
        return p && p.match !== null ? { id: t.id, n: i + 1, scenario: (lesson.scenarios.find((s) => s.trials.includes(t)) as MotionScenario).id, kind: t.kind, anomaly: t.anomaly, match: p.match, confidence: p.confidence, thinkMs: p.thinkMs, coverage: p.explanation?.coverage ?? null, words: p.explanation?.words ?? 0 } : null;
      }).filter(Boolean),
      total: trials.length,
    },
  };
}
