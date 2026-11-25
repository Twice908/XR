import { rngFor } from './questionEngine';
import type express from 'express';
import * as snd from './sound';

export interface SoundDeps {
  wrap: (fn: (req: express.Request, res: express.Response) => Promise<unknown>) => (req: express.Request, res: express.Response) => void;
  sessionFor: (req: express.Request, sessionId: string) => Promise<{ studentId: string } | null>;
  readLesson: (id: string) => any;
  load: (sessionId: string) => Promise<snd.SoundAssignment | null>;
  save: (sessionId: string, a: snd.SoundAssignment) => Promise<unknown>;
}

/** The lesson for a Sound & Waves session: this session's own draw, answers removed. */
export async function soundLessonFor(d: SoundDeps, lesson: any, sessionId: string, studentId: string | null) {
  if (!sessionId || !studentId) return snd.redactSound(snd.personalize(lesson, snd.makePlan(lesson)));
  let a = await d.load(sessionId);
  if (!a) {
    a = { kind: 'sound', lessonId: lesson.lessonId, studentId, plan: snd.makePlan(lesson, rngFor(sessionId, lesson.lessonId)), trials: {}, submission: null, createdAt: Date.now() };
    await d.save(sessionId, a);
  }
  return snd.redactSound(snd.personalize(lesson, a.plan));
}

/** What the coach and the rubric engine read. Never exposed to browsers. */
export function soundInternal(so: snd.SoundAssignment, lesson: any) {
  const p = snd.personalize(lesson, so.plan);
  const items = snd.flatTasks(p).map((t) => ({
    id: t.id,
    name: t.id.replace('_', ' '),
    facts: t.explanation ?? t.expectedOutcome ?? '',
    terms: [t.predictionOptions.find((o) => o.id === t.answer)?.label ?? ''].filter((x) => x.length > 3),
    open: !so.trials[t.id]?.explanation,
  }));
  return {
    kind: 'sound',
    lessonId: so.lessonId,
    studentId: so.studentId,
    submitted: so.submission !== null,
    submission: null,
    tubes: items.map((x, i) => ({ tube: i + 1, id: x.id, name: x.name, formula: '', type: '', ph: 0, facts: x.facts, terms: x.terms, open: x.open })),
    sound: snd.truthFor(lesson, so),
  };
}

export function registerSound(app: express.Express, d: SoundDeps) {
  const ctx = async (req: express.Request, res: express.Response) => {
    const { sessionId } = req.params;
    if (!(await d.sessionFor(req, sessionId))) {
      res.status(401).json({ error: 'Invalid session' });
      return null;
    }
    const a = await d.load(sessionId);
    if (!a) {
      res.status(404).json({ error: 'No sound lab is running for this session' });
      return null;
    }
    // Always the raw lesson: this session's draw lives in the plan.
    return { sessionId, a, lesson: d.readLesson(a.lessonId) };
  };

  // Commit a prediction and run the experiment. Nothing is disclosed unless the act was really performed.
  app.post(
    '/sessions/:sessionId/sound/trial',
    d.wrap(async (req, res) => {
      const c = await ctx(req, res);
      if (!c) return;
      const { sessionId, a, lesson } = c;
      if (a.submission) return res.status(409).json({ error: 'This experiment was already submitted' });
      const id = String(req.body?.id ?? '');
      const owed = snd.owesExplanation(a);
      if (owed && owed.id !== id) return res.status(409).json({ error: 'Explain your last run first' });
      const stored = a.trials[id];
      const judged = snd.judgeTrial(lesson, a.plan, id, stored ? stored.prediction : req.body?.prediction, stored ? stored.act : req.body?.act ?? {});
      if (!judged) return res.status(400).json({ error: 'Unknown task or incomplete prediction' });
      if ('error' in judged) return res.status(400).json({ error: judged.error });
      if (!stored) {
        const confidence = [1, 2, 3].includes(Number(req.body?.confidence)) ? (Number(req.body.confidence) as 1 | 2 | 3) : null;
        if (!confidence) return res.status(400).json({ error: 'Say how sure you are' });
        const now = Date.now();
        a.trials[id] = { id, prediction: judged.stored, confidence, thinkMs: Math.max(0, Math.min(3_600_000, Number(req.body?.thinkMs) || 0)), at: now, resultAt: now, match: judged.match, act: judged.act, calcAttempts: 0, calcValue: null, calcOk: false };
        await d.save(sessionId, a);
      }
      res.json({ ...judged.result, hasCalc: snd.hasCalc(lesson, a.plan, id) });
    }),
  );

  // The calculation some runs end in, checked against the student's own reading.
  app.post(
    '/sessions/:sessionId/sound/calc',
    d.wrap(async (req, res) => {
      const c = await ctx(req, res);
      if (!c) return;
      const { sessionId, a, lesson } = c;
      const t = a.trials[String(req.body?.id ?? '')];
      if (!t) return res.status(409).json({ error: 'Run the experiment first' });
      const r = snd.checkCalc(lesson, a.plan, t, req.body?.value);
      if ('error' in r) return res.status(400).json({ error: r.error });
      await d.save(sessionId, a);
      res.json(r);
    }),
  );

  // The explanation each run owes. Only now is the explanation of what happened disclosed.
  app.post(
    '/sessions/:sessionId/sound/explain',
    d.wrap(async (req, res) => {
      const c = await ctx(req, res);
      if (!c) return;
      const { sessionId, a, lesson } = c;
      if (a.submission) return res.status(409).json({ error: 'This experiment was already submitted' });
      const id = String(req.body?.id ?? '');
      const r = snd.checkExplanation(lesson, a, id, req.body ?? {}, Date.now());
      if ('error' in r) return res.status(400).json({ error: r.error });
      const t = a.trials[id];
      if (!t.explanation) {
        t.explanation = r.explanation;
        await d.save(sessionId, a);
      }
      res.json({ ok: true, words: t.explanation.words, reveal: snd.revealFor(lesson, a.plan, id) });
    }),
  );

  // Explain-aloud audio, kept with the session for the instructor.
  app.post(
    '/sessions/:sessionId/sound/audio',
    d.wrap(async (req, res) => {
      const c = await ctx(req, res);
      if (!c) return;
      const { sessionId, a } = c;
      const id = String(req.body?.id ?? '');
      const b64 = String(req.body?.fileBase64 ?? '');
      const type = String(req.body?.contentType ?? 'audio/webm');
      const t = a.trials[id];
      if (!t?.explanation) return res.status(409).json({ error: 'Explain this run first' });
      if (!/^audio\//.test(type) || b64.length === 0 || b64.length > 5_000_000) return res.status(400).json({ error: 'Invalid audio' });
      const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
      const store = await fetch(`${process.env.OBJECT_STORE_URL || 'http://localhost:3006'}/upload/base64`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: `sound_${sessionId}_${id}.${ext}`, contentType: type, fileBase64: b64 }),
      });
      if (!store.ok) return res.status(502).json({ error: 'Could not store the audio' });
      const data = (await store.json()) as { url?: string };
      t.explanation.audioUrl = data.url;
      await d.save(sessionId, a);
      res.status(201).json({ stored: true });
    }),
  );

  app.post(
    '/sessions/:sessionId/sound/submit',
    d.wrap(async (req, res) => {
      const c = await ctx(req, res);
      if (!c) return;
      const { sessionId, a, lesson } = c;
      if (!snd.allDone(lesson, a)) return res.status(409).json({ error: 'Finish every task (predict, run, calculate where asked, explain) first' });
      if (!a.submission) {
        a.submission = { at: Date.now() };
        await d.save(sessionId, a);
      }
      res.json(snd.buildReveal(lesson, a));
    }),
  );
}
