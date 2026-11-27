import { describe, expect, it } from 'vitest';
import { createAnthropic } from '../providers/anthropic';
import { ProviderError, type CompletionRequest, type FetchLike, type LlmProvider, type ProviderName, type ProviderRegistry } from '../providers';
import { CoachSession } from '../session';
import type { Assignment, ServerMessage, Snapshot } from '../protocol';
import type { TtsEngine } from '../voice/tts';

// ---- the Anthropic stream ----

const sse = (events: { event: string; data: unknown }[]) => events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
function streamingFetch(body: string, status = 200, chunk = 7) {
  const calls: any[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const bytes = new TextEncoder().encode(body);
    return {
      ok: status < 400,
      status,
      json: async () => ({}),
      text: async () => 'nope',
      // Arrives in small, awkward chunks, as a network stream does.
      body: new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk));
          c.close();
        },
      }),
    };
  };
  return { f, calls };
}
const req = { system: 'SYS', turns: [{ role: 'user' as const, text: 'hi' }] };

describe('Anthropic stream', () => {
  it('yields only the text pieces, from a stream split anywhere', async () => {
    const { f, calls } = streamingFetch(
      sse([
        { event: 'message_start', data: { type: 'message_start' } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } } },
        { event: 'ping', data: { type: 'ping' } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'What did ' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'you see?' } } },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ]),
    );
    const p = createAnthropic({ CLAUDE_API_KEY: 'k' }, f);
    const pieces: string[] = [];
    for await (const t of p.stream!(req)) pieces.push(t);
    expect(pieces.join('')).toBe('What did you see?');
    expect(calls[0].body.stream).toBe(true);
    expect(calls[0].body.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  it('maps HTTP and in-stream errors to provider errors', async () => {
    const p401 = createAnthropic({ CLAUDE_API_KEY: 'k' }, streamingFetch('', 401).f);
    await expect((async () => { for await (const _ of p401.stream!(req)) void _; })()).rejects.toMatchObject({ kind: 'auth' });
    const pErr = createAnthropic({ CLAUDE_API_KEY: 'k' }, streamingFetch(sse([{ event: 'error', data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } } }])).f);
    await expect((async () => { for await (const _ of pErr.stream!(req)) void _; })()).rejects.toBeInstanceOf(ProviderError);
  });
});

// ---- the session, streaming ----

const tubes: Assignment['tubes'] = [{ tube: 1, id: 'hcl', name: 'Hydrochloric Acid', formula: 'HCl', type: 'acid', ph: 1 }];
const snapshot: Snapshot = { phase: 'testing', tools: [], activeTool: null, tubes: [] };
const tick = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

/** A provider whose stream hands out one piece each time the test calls next(). */
function steppedProvider(pieces: (string | Error)[]) {
  let step: () => void = () => undefined;
  let stopped = false;
  const provider: LlmProvider = {
    name: 'anthropic' as ProviderName,
    model: 'fake',
    isConfigured: () => true,
    complete: async () => 'unused',
    async *stream(_r: CompletionRequest) {
      try {
        for (const p of pieces) {
          await new Promise<void>((r) => (step = r));
          if (p instanceof Error) throw p;
          yield p;
        }
      } finally {
        stopped = true;
      }
    },
  };
  return { provider, next: async () => (step(), tick()), finish: async () => { for (let i = 0; i <= pieces.length; i++) { step(); await tick(); } }, stopped: () => stopped };
}

function setup(pieces: (string | Error)[], voice = true) {
  const sp = steppedProvider(pieces);
  const out: ServerMessage[] = [];
  const tts: TtsEngine = { name: 'fake', available: () => true, synthesize: async (t) => new TextEncoder().encode(t) };
  const s = new CoachSession({ registry: { active: sp.provider } as unknown as ProviderRegistry, loadAssignment: async () => ({ submitted: false, tubes }), tts, send: (m) => out.push(m) });
  void s.handle({ type: 'hello', lessonId: 'chemistry-101', title: 'Lab', labType: 'chemistry_indicators', voice });
  const of = <T extends ServerMessage['type']>(type: T) => out.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  return { s, out, of, ...sp };
}

describe('CoachSession streaming', () => {
  it('sends and speaks the first sentence while the model is still writing', async () => {
    const h = setup(['You saw the litmus turn ', 'red just now. What did you ', 'expect before you tested it?']);
    const p = h.s.handle({ type: 'ask', text: 'q', snapshot });
    await tick();
    await h.next();
    await h.next(); // the second sentence has started, so the first is complete
    expect(h.of('coach_part').map((m) => m.text)).toEqual(['You saw the litmus turn red just now.']);
    expect(h.of('coach_audio')).toHaveLength(1);
    expect(h.of('coach')).toHaveLength(0);
    await h.finish();
    await p;
    expect(h.of('coach_part').map((m) => [m.seq, m.text])).toEqual([[0, 'You saw the litmus turn red just now.'], [1, 'What did you expect before you tested it?']]);
    const final = h.of('coach')[0];
    expect(final).toMatchObject({ text: 'You saw the litmus turn red just now. What did you expect before you tested it?', streamed: true, blocked: false });
    expect(h.of('coach_audio').map((m) => [m.seq, m.last, m.data === ''])).toEqual([[0, false, false], [1, false, false], [2, true, true]]);
  });

  it('catches a leak in a later sentence: the redirect replaces it and the model is stopped', async () => {
    const h = setup(['Look closely at the colour you saw. ', 'Tube 1 holds hydrochloric acid, by the way. ', 'More text that must never be read.']);
    const p = h.s.handle({ type: 'ask', text: 'what is it?', snapshot });
    await tick();
    await h.finish();
    await p;
    const parts = h.of('coach_part').map((m) => m.text);
    expect(parts[0]).toBe('Look closely at the colour you saw.');
    expect(parts).toHaveLength(2);
    expect(parts.join(' ')).not.toMatch(/hydrochloric|must never/i);
    expect(h.of('coach')[0].blocked).toBe(true);
    expect(h.stopped()).toBe(true);
    expect(h.of('coach_audio').map((m) => m.text).join(' ')).not.toMatch(/hydrochloric/i);
  });

  it('talking stops the stream: no more sentences, no closing message', async () => {
    const h = setup(['First sentence that is long enough. ', 'Second sentence that is long enough. ', 'Third one.']);
    const p = h.s.handle({ type: 'ask', text: 'q', snapshot });
    await tick();
    await h.next();
    await h.next();
    await h.s.handle({ type: 'floor', talking: true });
    await h.finish();
    await p;
    expect(h.of('coach_part')).toHaveLength(1);
    expect(h.of('coach')).toHaveLength(0);
    expect(h.of('coach_cancelled')[0]).toMatchObject({ reason: 'talking' });
  });

  it('falls back to the lab line when the stream fails before anything is said', async () => {
    const h = setup([new ProviderError('network', 'down')], false);
    const p = h.s.handle({ type: 'ask', text: 'q', snapshot });
    await tick();
    await h.finish();
    await p;
    expect(h.of('coach_part')).toHaveLength(0);
    expect(h.of('coach')[0]).toMatchObject({ degraded: true });
    expect(h.of('coach')[0].streamed).toBeUndefined();
  });

  it('keeps what was said when the stream fails part-way', async () => {
    const h = setup(['A first sentence that is complete. ', 'And then', new ProviderError('network', 'cut')], false);
    const p = h.s.handle({ type: 'ask', text: 'q', snapshot });
    await tick();
    await h.finish();
    await p;
    expect(h.of('coach')[0]).toMatchObject({ text: 'A first sentence that is complete.', degraded: true, streamed: true });
  });
});
