import type express from 'express';
import { wordCount } from './biology';

/*
 * "Explain your conclusions": the spoken or typed reasoning a student gives before submitting the indicators
 * or metals lab. It is kept with the session (first one wins) for the instructor; it never changes the score
 * the engine computes from conclusions, and the audio is stored the same way as in the digestive-system lab.
 */

export interface Reasoning {
  text: string;
  words: number;
  inputMode: 'voice' | 'typed';
  speakMs: number;
  at: number;
  audioUrl?: string;
}
type WithReasoning = { kind?: string; submission?: unknown; reasoning?: Reasoning };

export interface ReasoningDeps {
  wrap: (fn: (req: express.Request, res: express.Response) => Promise<unknown>) => (req: express.Request, res: express.Response) => void;
  sessionFor: (req: express.Request, sessionId: string) => Promise<{ studentId: string } | null>;
  load: (sessionId: string) => Promise<WithReasoning | null>;
  save: (sessionId: string, a: any) => Promise<unknown>;
}

export const MIN_REASONING_WORDS = 8;
const supports = (a: WithReasoning) => a.kind === undefined || a.kind === 'indicators' || a.kind === 'metals';

export const reasoningSummary = (a: WithReasoning) => (a.reasoning ? { words: a.reasoning.words, inputMode: a.reasoning.inputMode, speakMs: a.reasoning.speakMs } : null);

export function registerReasoning(app: express.Express, d: ReasoningDeps) {
  const ctx = async (req: express.Request, res: express.Response) => {
    const { sessionId } = req.params;
    if (!(await d.sessionFor(req, sessionId))) {
      res.status(401).json({ error: 'Invalid session' });
      return null;
    }
    const a = await d.load(sessionId);
    if (!a || !supports(a)) {
      res.status(404).json({ error: 'No lab is running for this session' });
      return null;
    }
    return { sessionId, a };
  };

  app.post(
    '/sessions/:sessionId/reasoning',
    d.wrap(async (req, res) => {
      const c = await ctx(req, res);
      if (!c) return;
      if (c.a.reasoning) return res.json({ stored: true, kept: true });
      if (c.a.submission) return res.status(409).json({ error: 'This experiment was already submitted' });
      const text = String(req.body?.text ?? '').trim().slice(0, 2000);
      const words = wordCount(text);
      if (words < MIN_REASONING_WORDS) return res.status(400).json({ error: `Explain it in at least ${MIN_REASONING_WORDS} words` });
      c.a.reasoning = {
        text,
        words,
        inputMode: req.body?.inputMode === 'voice' ? 'voice' : 'typed',
        speakMs: Math.max(0, Math.min(600_000, Number(req.body?.speakMs) || 0)),
        at: Date.now(),
      };
      await d.save(c.sessionId, c.a);
      res.status(201).json({ stored: true });
    }),
  );

  app.post(
    '/sessions/:sessionId/reasoning/audio',
    d.wrap(async (req, res) => {
      const c = await ctx(req, res);
      if (!c) return;
      if (!c.a.reasoning) return res.status(409).json({ error: 'Explain your conclusions first' });
      const b64 = String(req.body?.fileBase64 ?? '');
      const type = String(req.body?.contentType ?? 'audio/webm');
      if (!/^audio\//.test(type) || b64.length === 0 || b64.length > 5_000_000) return res.status(400).json({ error: 'Invalid audio' });
      const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm';
      const store = await fetch(`${process.env.OBJECT_STORE_URL || 'http://localhost:3006'}/upload/base64`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: `reasoning_${c.sessionId}.${ext}`, contentType: type, fileBase64: b64 }),
      });
      if (!store.ok) return res.status(502).json({ error: 'Could not store the audio' });
      const data = (await store.json()) as { url?: string };
      c.a.reasoning.audioUrl = data.url;
      await d.save(c.sessionId, c.a);
      res.status(201).json({ stored: true });
    }),
  );
}
