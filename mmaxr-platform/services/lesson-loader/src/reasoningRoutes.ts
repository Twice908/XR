import type express from 'express';
import { wordCount } from './biology';

/*
 * "Explain your conclusions": the spoken or typed reasoning a student gives before submitting the indicators
 * or metals lab. It is kept with the session (first one wins) for the instructor; it never changes the score
 * the engine computes from conclusions, and the audio is stored the same way as in the digestive-system lab.
 */

export interface ReasoningQuality {
  /** Distinct pieces of evidence (colours, tests, properties) the student cites. */
  evidence: number;
  /** Reasoning words such as because, so, which means. */
  causal: number;
  /** Share of the tubes or samples the student refers to. */
  coverage: number;
  /** 0-1 blend used by the rubric. */
  score: number;
}

export interface Reasoning {
  quality?: ReasoningQuality;
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

const EVIDENCE: Record<'indicators' | 'metals', string[]> = {
  indicators: ['red', 'blue', 'pink', 'purple', 'yellow', 'orange', 'green', 'colourless', 'colorless', 'clear', 'litmus', 'phenolphthalein', 'methyl orange', 'universal', 'indicator', 'ph paper', 'paper', 'ph', 'acid', 'base', 'alkali', 'neutral'],
  metals: ['conduct', 'conductor', 'conductivity', 'electricity', 'heat', 'sonorous', 'sound', 'ring', 'malleable', 'hammer', 'ductile', 'wire', 'lustre', 'luster', 'shiny', 'dull', 'brittle', 'water', 'oxygen', 'burn', 'flame', 'litmus', 'oxide', 'bubbles', 'reacts'],
};
const CAUSAL = ['because', 'since', 'so', 'therefore', 'which means', 'means', 'shows', 'showed', 'suggests', 'indicates', 'proves', 'as a result', 'that is why', 'thats why', 'due to'];
const norm = (s: string) => ` ${s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
const has = (hay: string, term: string) => hay.includes(` ${term} `);

/**
 * How well a student's explanation of their conclusions is grounded: do they cite evidence, give reasons, and
 * speak to each tube or sample? Deterministic and blind to correctness; the rubric blends it with accuracy.
 */
export function reasoningQuality(text: string, kind: 'indicators' | 'metals', items: number): ReasoningQuality {
  const hay = norm(text);
  const evidence = EVIDENCE[kind].filter((t) => has(hay, t)).length;
  const causal = CAUSAL.filter((t) => has(hay, t)).length;
  const label = kind === 'metals' ? 'sample' : 'tube';
  const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
  let referenced = 0;
  for (let i = 1; i <= items; i++) if (has(hay, `${label} ${i}`) || has(hay, `${label}s ${i}`) || has(hay, `number ${i}`) || has(hay, `no ${i}`) || has(hay, `${ordinals[i - 1] ?? '#'}`) || new RegExp(`\\b${label}s?\\s+(?:\\d+\\s*(?:,|and|&)\\s*)*${i}\\b`).test(hay)) referenced++;
  const coverage = items ? referenced / items : 0;
  const score = 0.4 * Math.min(1, evidence / 3) + 0.3 * Math.min(1, causal / 2) + 0.3 * coverage;
  return { evidence, causal, coverage: Math.round(coverage * 100) / 100, score: Math.round(score * 100) / 100 };
}
const supports = (a: WithReasoning) => a.kind === undefined || a.kind === 'indicators' || a.kind === 'metals';

export const reasoningSummary = (a: WithReasoning) => (a.reasoning ? { words: a.reasoning.words, inputMode: a.reasoning.inputMode, speakMs: a.reasoning.speakMs, quality: a.reasoning.quality ?? null } : null);

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
      const items = (c.a as any).tubes?.length ?? (c.a as any).samples?.length ?? 0;
      c.a.reasoning = {
        quality: reasoningQuality(text, c.a.kind === 'metals' ? 'metals' : 'indicators', items),
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
