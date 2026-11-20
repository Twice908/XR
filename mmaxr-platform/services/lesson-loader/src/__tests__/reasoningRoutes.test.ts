import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { reasoningSummary, registerReasoning } from '../reasoningRoutes';

let server: Server;
let base = '';
let store: any = null;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerReasoning(app, {
    wrap: (fn) => (req, res) => void fn(req, res).catch((e) => res.status(500).json({ error: String(e) })),
    sessionFor: async (req) => (req.headers.authorization === 'Bearer good' ? { studentId: 's' } : null),
    load: async () => store,
    save: async (_id, a) => void (store = a),
  });
  await new Promise<void>((r) => (server = app.listen(0, r)));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/sessions/s1`;
});
afterAll(() => server.close());

const post = async (path: string, body: unknown, token = 'good') => {
  const r = await fetch(`${base}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, body: (await r.json()) as any };
};
const words = 'I compared the colour with both indicators and the pH paper and decided each tube from that evidence.';

describe('reasoning routes', () => {
  it('needs the student’s own session and a running indicators or metals lab', async () => {
    store = { tubes: [] };
    expect((await post('reasoning', { text: words }, 'bad')).status).toBe(401);
    store = { kind: 'biology' };
    expect((await post('reasoning', { text: words })).status).toBe(404);
    store = null;
    expect((await post('reasoning', { text: words })).status).toBe(404);
  });
  it('stores spoken reasoning once and keeps the first', async () => {
    store = { kind: 'metals', submission: null };
    const ok = await post('reasoning', { text: words, inputMode: 'voice', speakMs: 12000 });
    expect(ok.status).toBe(201);
    expect(reasoningSummary(store)).toMatchObject({ inputMode: 'voice', speakMs: 12000 });
    const again = await post('reasoning', { text: 'a completely different set of words that should be ignored here', inputMode: 'typed' });
    expect(again.body.kept).toBe(true);
    expect(store.reasoning.text).toBe(words);
  });
  it('rejects too-short reasoning and anything after submission', async () => {
    store = { submission: null };
    expect((await post('reasoning', { text: 'too short' })).status).toBe(400);
    store = { submission: { at: 1 } };
    expect((await post('reasoning', { text: words })).status).toBe(409);
  });
  it('audio needs the reasoning first, and a real audio type', async () => {
    store = { kind: 'metals' };
    expect((await post('reasoning/audio', { contentType: 'audio/webm', fileBase64: 'AAAA' })).status).toBe(409);
    store = { kind: 'metals', reasoning: { text: words, words: 17, inputMode: 'voice', speakMs: 1, at: 1 } };
    expect((await post('reasoning/audio', { contentType: 'text/html', fileBase64: 'AAAA' })).status).toBe(400);
  });
});

import { reasoningQuality } from '../reasoningRoutes';

describe('reasoning quality', () => {
  it('rewards evidence, reasons and covering every tube', () => {
    const good = reasoningQuality('Tube 1 turned red with litmus, so it is an acid. Tube 2 went blue because the pH paper showed a base, and tube 3 stayed colourless with phenolphthalein.', 'indicators', 3);
    expect(good.evidence).toBeGreaterThanOrEqual(3);
    expect(good.causal).toBeGreaterThanOrEqual(2);
    expect(good.coverage).toBe(1);
    expect(good.score).toBeGreaterThan(0.9);
  });
  it('gives little for a vague answer', () => {
    const vague = reasoningQuality('I just looked at them and chose what felt right to me in the end.', 'indicators', 3);
    expect(vague.score).toBeLessThan(0.2);
  });
  it('knows metals vocabulary and sample references', () => {
    const q = reasoningQuality('Sample 1 conducts electricity and is shiny and malleable so it is a metal, but sample 2 is brittle and dull.', 'metals', 2);
    expect(q.coverage).toBe(1);
    expect(q.evidence).toBeGreaterThanOrEqual(4);
  });
  it('is stored with the reasoning', async () => {
    store = { kind: 'metals', samples: [{}, {}], submission: null };
    await post('reasoning', { text: 'Sample 1 conducts electricity so it is a metal, and sample 2 is brittle and dull.' });
    expect(store.reasoning.quality.coverage).toBe(1);
    expect(reasoningSummary(store)?.quality?.score).toBeGreaterThan(0.5);
  });
});
