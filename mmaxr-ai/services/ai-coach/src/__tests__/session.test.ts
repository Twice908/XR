import { describe, expect, it } from 'vitest';
import { CoachSession } from '../session';
import { ProviderError, type CompletionRequest, type LlmProvider, type ProviderName } from '../providers';
import type { ProviderRegistry } from '../providers';
import type { ServerMessage, Snapshot } from '../protocol';

function fakeRegistry(reply: string | ((r: CompletionRequest) => string) | Error) {
  const seen: CompletionRequest[] = [];
  const p: LlmProvider = {
    name: 'anthropic' as ProviderName,
    model: 'fake',
    isConfigured: () => true,
    async complete(r) {
      seen.push(r);
      if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply(r) : reply;
    },
  };
  return { registry: { active: p } as unknown as ProviderRegistry, seen };
}

const secrets = [
  { tube: 1, terms: ['Hydrochloric Acid', 'HCl'], verdict: 'acid', ph: 1 },
  { tube: 2, terms: ['Sodium Chloride', 'NaCl'], verdict: 'neutral', ph: 7 },
];
const snapshot: Snapshot = {
  phase: 'testing',
  tools: ['Litmus Paper'],
  activeTool: 'Litmus Paper',
  tubes: [{ n: 1, tests: [{ tool: 'Litmus Paper', predicted: 'Blue', observed: 'Red', matched: false, recorded: null }], conclusion: null, revisions: 0, recordedPh: null }],
};

function setup(reply: Parameters<typeof fakeRegistry>[0], clock = { t: 1_000_000 }) {
  const { registry, seen } = fakeRegistry(reply);
  const out: ServerMessage[] = [];
  const s = new CoachSession({ registry, send: (m) => out.push(m), now: () => clock.t });
  void s.handle({ type: 'hello', lessonId: 'chemistry-101', title: 'Acids, Bases & Indicators', labType: 'chemistry_indicators', secrets });
  return { s, out, seen, clock };
}
const coach = (out: ServerMessage[]) => out.filter((m): m is Extract<ServerMessage, { type: 'coach' }> => m.type === 'coach');

describe('CoachSession', () => {
  it('answers a question using only student-visible state, never the hidden answers', async () => {
    const { s, seen, out } = setup('What did you expect the litmus to do, and why?');
    await s.handle({ type: 'ask', text: 'what is tube 1?', snapshot });
    const sent = JSON.stringify(seen[0]);
    for (const secret of ['Hydrochloric', 'HCl', 'Sodium Chloride', 'NaCl']) expect(sent).not.toContain(secret);
    expect(seen[0].system).toMatch(/not told what is in any tube/i);
    expect(sent).toContain('predicted Blue, saw Red (not as predicted)');
    expect(coach(out)[0]).toMatchObject({ reason: 'reply', blocked: false, degraded: false });
  });

  it('blocks a reply that leaks the answer and substitutes a Socratic redirect', async () => {
    const { s, out } = setup('Tube 1 is hydrochloric acid, so it turns litmus red.');
    await s.handle({ type: 'ask', text: 'tell me', snapshot });
    const m = coach(out)[0];
    expect(m.blocked).toBe(true);
    expect(m.text).not.toMatch(/hydrochloric/i);
  });

  it('lets the coach echo the student\'s own conclusion back', async () => {
    const { s, out } = setup('You said tube 1 is an acid. What made you sure?');
    const snap = { ...snapshot, tubes: [{ ...snapshot.tubes[0], conclusion: 'acid' }] };
    await s.handle({ type: 'ask', text: 'why?', snapshot: snap });
    expect(coach(out)[0].blocked).toBe(false);
  });

  it('degrades to a deterministic hint when the provider fails, without throwing', async () => {
    const { s, out } = setup(new ProviderError('billing', 'no credit'));
    await s.handle({ type: 'ask', text: 'help', snapshot });
    const m = coach(out)[0];
    expect(m.degraded).toBe(true);
    expect(m.text.length).toBeGreaterThan(10);
  });

  it('respects the mode: off is silent, on_request ignores nudges, proactive nudges', async () => {
    const a = setup('A question?');
    await a.s.handle({ type: 'event', kind: 'prediction_mismatch', detail: 'x', snapshot });
    expect(coach(a.out)).toHaveLength(1);

    const b = setup('A question?');
    await b.s.handle({ type: 'mode', mode: 'on_request' });
    await b.s.handle({ type: 'event', kind: 'prediction_mismatch', detail: 'x', snapshot });
    expect(coach(b.out)).toHaveLength(0);
    await b.s.handle({ type: 'ask', text: 'hi', snapshot });
    expect(coach(b.out)).toHaveLength(1);

    const c = setup('A question?');
    await c.s.handle({ type: 'mode', mode: 'off' });
    await c.s.handle({ type: 'ask', text: 'hi', snapshot });
    expect(coach(c.out)).toHaveLength(0);
    expect(c.out.some((m) => m.type === 'coach_off')).toBe(true);
    expect(c.seen).toHaveLength(0);
  });

  it('rate-limits unprompted nudges', async () => {
    const { s, out, clock } = setup('A question?');
    await s.handle({ type: 'event', kind: 'revision', detail: 'one', snapshot });
    clock.t += 5_000;
    await s.handle({ type: 'event', kind: 'revision', detail: 'two', snapshot });
    expect(coach(out)).toHaveLength(1);
    clock.t += 30_000;
    await s.handle({ type: 'event', kind: 'revision', detail: 'three', snapshot });
    expect(coach(out)).toHaveLength(2);
  });

  it('after the reveal the answers go into the prompt and the guard opens up', async () => {
    const { s, seen, out } = setup('Tube 1 held hydrochloric acid, a strong acid, which is why litmus went red.');
    await s.handle({ type: 'reveal', truth: [{ tube: 1, name: 'Hydrochloric Acid', formula: 'HCl', type: 'acid', ph: 1 }], snapshot });
    expect(seen[0].system).toContain('Hydrochloric Acid (HCl)');
    const m = coach(out)[0];
    expect(m).toMatchObject({ reason: 'wrapup', blocked: false });
    expect(m.text).toContain('hydrochloric');
  });

  it('keeps a bounded conversation history', async () => {
    const { s, seen } = setup('Okay?');
    for (let i = 0; i < 15; i++) await s.handle({ type: 'ask', text: `q${i}`, snapshot });
    expect(seen[seen.length - 1].turns.length).toBeLessThanOrEqual(21);
  });
});
