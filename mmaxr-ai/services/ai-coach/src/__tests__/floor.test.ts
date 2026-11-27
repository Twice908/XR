import { describe, expect, it } from 'vitest';
import { Floor } from '../floor';
import { CoachSession } from '../session';
import type { CompletionRequest, LlmProvider, ProviderName, ProviderRegistry } from '../providers';
import type { ServerMessage, Snapshot } from '../protocol';
import type { TtsEngine } from '../voice/tts';

describe('Floor', () => {
  it('holds nudges while narrating, then for a quiet spell after', () => {
    const clock = { t: 0 };
    const f = new Floor(() => clock.t);
    expect(f.canNudge(false)).toBeNull();
    f.update({ narrating: true });
    expect(f.canNudge(false)).toBe('narration playing');
    clock.t = 5_000;
    f.update({ narrating: false });
    clock.t = 12_000;
    expect(f.canNudge(false)).toBe('narration just ended');
    clock.t = 13_001;
    expect(f.canNudge(false)).toBeNull();
    expect(f.canNudge(true)).toBe('coach still speaking');
  });

  it('reports the moment the student starts talking, once', () => {
    const f = new Floor(() => 0);
    expect(f.update({ talking: true })).toBe(true);
    expect(f.update({ talking: true })).toBe(false);
    expect(f.canNudge(false)).toBe('student talking');
    f.update({ talking: false });
    expect(f.canNudge(false)).toBeNull();
  });

  it('expires a state the browser never cleared', () => {
    const clock = { t: 0 };
    const f = new Floor(() => clock.t);
    f.update({ narrating: true, talking: true });
    clock.t = 61_000;
    expect(f.talking).toBe(false);
    expect(f.narrating).toBe(false);
    clock.t = 70_000;
    expect(f.canNudge(false)).toBeNull();
  });
});

// ---- the session, with a provider and a voice that wait until released ----

const snapshot: Snapshot = { phase: 'testing', tools: [], activeTool: null, tubes: [] };
/** Lets the session run up to its next wait (it awaits the assignment and context before asking the model). */
const tick = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

function harness(opts: { voice?: boolean } = {}) {
  const clock = { t: 1_000_000 };
  const seen: CompletionRequest[] = [];
  const waiting: { text: string; release: () => void }[] = [];
  const provider: LlmProvider = {
    name: 'anthropic' as ProviderName,
    model: 'fake',
    isConfigured: () => true,
    complete(r) {
      seen.push(r);
      const n = seen.length;
      return new Promise<string>((resolve, reject) => {
        if (r.signal?.aborted) return reject(new Error('aborted'));
        const entry = { text: `Reply ${n}`, release: () => resolve(`Reply ${n}, long enough to speak aloud. And a second sentence for it.`) };
        r.signal?.addEventListener('abort', () => {
          waiting.splice(waiting.indexOf(entry), 1);
          reject(new Error('aborted'));
        });
        waiting.push(entry);
      });
    },
  };
  const speechGates: (() => void)[] = [];
  const tts: TtsEngine = {
    name: 'fake',
    available: () => true,
    synthesize: (t, signal) =>
      new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')));
        speechGates.push(() => resolve(new TextEncoder().encode(t)));
      }),
  };
  const out: ServerMessage[] = [];
  const s = new CoachSession({ registry: { active: provider } as unknown as ProviderRegistry, loadAssignment: async () => null, tts, send: (m) => out.push(m), now: () => clock.t });
  void s.handle({ type: 'hello', lessonId: 'x', title: 'X', labType: 'x', voice: opts.voice ?? false });
  const releaseLlm = async () => {
    waiting.shift()?.release();
    await tick();
  };
  const releaseSpeech = async () => {
    speechGates.shift()?.();
    await tick();
  };
  const of = <T extends ServerMessage['type']>(type: T) => out.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  return { s, out, seen, clock, releaseLlm, releaseSpeech, of };
}

describe('CoachSession floor', () => {
  it('talking stops a reply that is still thinking: nothing is sent, nothing remembered', async () => {
    const h = harness();
    const first = h.s.handle({ type: 'ask', text: 'first question', snapshot });
    await tick();
    expect(h.of('thinking')[0].id).toBe('c1');
    await h.s.handle({ type: 'floor', talking: true });
    await first;
    expect(h.of('coach_cancelled')).toEqual([{ type: 'coach_cancelled', id: 'c1', reason: 'talking' }]);
    expect(h.of('coach')).toHaveLength(0);
    await h.s.handle({ type: 'floor', talking: false });
    const second = h.s.handle({ type: 'ask', text: 'second question', snapshot });
    await tick();
    await h.releaseLlm();
    await second;
    expect(JSON.stringify(h.seen[1].turns)).not.toContain('first question');
    expect(h.of('coach').map((c) => c.id)).toEqual(['c2']);
  });

  it('talking stops a reply part-way through being spoken', async () => {
    const h = harness({ voice: true });
    const p = h.s.handle({ type: 'ask', text: 'q', snapshot });
    await tick();
    await h.releaseLlm();
    await h.releaseSpeech(); // first sentence out
    expect(h.of('coach_audio')).toHaveLength(1);
    await h.s.handle({ type: 'floor', talking: true });
    await p;
    expect(h.of('coach_cancelled')[0]).toMatchObject({ id: 'c1', reason: 'talking' });
    expect(h.of('coach_audio')).toHaveLength(1);
  });

  it('a new question replaces the one still being answered', async () => {
    const h = harness();
    const first = h.s.handle({ type: 'ask', text: 'one', snapshot });
    await tick();
    const second = h.s.handle({ type: 'ask', text: 'two', snapshot });
    await tick();
    await h.releaseLlm();
    await Promise.all([first, second]);
    expect(h.of('coach_cancelled')).toEqual([{ type: 'coach_cancelled', id: 'c1', reason: 'superseded' }]);
    expect(h.of('coach').map((c) => c.id)).toEqual(['c2']);
  });

  it('the browser can cancel the current reply by id; a stale id does nothing', async () => {
    const h = harness();
    const p = h.s.handle({ type: 'ask', text: 'q', snapshot });
    await tick();
    await h.s.handle({ type: 'cancel', id: 'c9' });
    expect(h.of('coach_cancelled')).toHaveLength(0);
    await h.s.handle({ type: 'cancel', id: 'c1' });
    await p;
    expect(h.of('coach_cancelled')).toEqual([{ type: 'coach_cancelled', id: 'c1', reason: 'cancelled' }]);
  });

  it('drops nudges during narration and its quiet spell, and allows one after', async () => {
    const h = harness();
    await h.s.handle({ type: 'floor', narrating: true });
    await h.s.handle({ type: 'event', kind: 'idle', snapshot });
    h.clock.t += 4_000;
    await h.s.handle({ type: 'floor', narrating: false });
    h.clock.t += 3_000;
    await h.s.handle({ type: 'event', kind: 'idle', snapshot });
    expect(h.seen).toHaveLength(0);
    h.clock.t += 6_000;
    const p = h.s.handle({ type: 'event', kind: 'idle', snapshot });
    await tick();
    await h.releaseLlm();
    await p;
    expect(h.of('coach').map((c) => c.reason)).toEqual(['nudge']);
  });

  it('drops a nudge while the student talks or a reply is in progress', async () => {
    const h = harness();
    await h.s.handle({ type: 'floor', talking: true });
    await h.s.handle({ type: 'event', kind: 'idle', snapshot });
    await h.s.handle({ type: 'floor', talking: false });
    const reply = h.s.handle({ type: 'ask', text: 'q', snapshot });
    await tick();
    await h.s.handle({ type: 'event', kind: 'prediction_mismatch', snapshot });
    expect(h.seen).toHaveLength(1);
    await h.releaseLlm();
    await reply;
    expect(h.of('coach').map((c) => c.reason)).toEqual(['reply']);
  });

  it('narration stops a nudge but never a reply to a question', async () => {
    const h = harness();
    const nudge = h.s.handle({ type: 'event', kind: 'idle', snapshot });
    await tick();
    await h.s.handle({ type: 'floor', narrating: true });
    await nudge;
    expect(h.of('coach_cancelled')).toEqual([{ type: 'coach_cancelled', id: 'c1', reason: 'narration' }]);
    await h.s.handle({ type: 'floor', narrating: false });
    const reply = h.s.handle({ type: 'ask', text: 'q', snapshot });
    await tick();
    await h.s.handle({ type: 'floor', narrating: true });
    await h.releaseLlm();
    await reply;
    expect(h.of('coach').map((c) => c.reason)).toEqual(['reply']);
    expect(h.of('coach_cancelled')).toHaveLength(1);
  });

  it('turning voice off stops the audio but keeps the reply', async () => {
    const h = harness({ voice: true });
    const p = h.s.handle({ type: 'ask', text: 'q', snapshot });
    await tick();
    await h.releaseLlm();
    await h.releaseSpeech();
    await h.s.handle({ type: 'voice', on: false });
    await h.releaseSpeech();
    await p;
    expect(h.of('coach')).toHaveLength(1);
    expect(h.of('coach_audio')).toHaveLength(1);
    expect(h.of('coach_cancelled')).toHaveLength(0);
  });
});
