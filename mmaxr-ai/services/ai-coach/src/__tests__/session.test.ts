import { describe, expect, it } from 'vitest';
import { CoachSession } from '../session';
import { ProviderError, type CompletionRequest, type LlmProvider, type ProviderName } from '../providers';
import type { ProviderRegistry } from '../providers';
import type { Assignment, ServerMessage, Snapshot } from '../protocol';

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

const tubes: Assignment['tubes'] = [
  { tube: 1, id: 'hcl', name: 'Hydrochloric Acid', formula: 'HCl', type: 'acid', ph: 1 },
  { tube: 2, id: 'nacl', name: 'Sodium Chloride', formula: 'NaCl', type: 'neutral', ph: 7 },
];
const snapshot: Snapshot = {
  phase: 'testing',
  tools: ['Litmus Paper'],
  activeTool: 'Litmus Paper',
  tubes: [{ n: 1, tests: [{ tool: 'Litmus Paper', predicted: 'Blue', observed: 'Red', matched: false, recorded: null }], conclusion: null, revisions: 0, recordedPh: null }],
};

function setup(reply: Parameters<typeof fakeRegistry>[0], opts: { submitted?: boolean; assignment?: Assignment | null } = {}, clock = { t: 1_000_000 }) {
  const { registry, seen } = fakeRegistry(reply);
  const out: ServerMessage[] = [];
  const assignment = opts.assignment === undefined ? { submitted: opts.submitted ?? false, tubes } : opts.assignment;
  const s = new CoachSession({ registry, loadAssignment: async () => assignment, send: (m) => out.push(m), now: () => clock.t });
  void s.handle({ type: 'hello', lessonId: 'chemistry-101', title: 'Acids, Bases & Indicators', labType: 'chemistry_indicators' });
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

  it('after the server confirms submission, the answers go into the prompt and the guard opens up', async () => {
    const { s, seen, out } = setup('Tube 1 held hydrochloric acid, a strong acid, which is why litmus went red.', { submitted: true });
    await s.handle({ type: 'reveal', snapshot });
    expect(seen[0].system).toContain('Hydrochloric Acid (HCl)');
    const m = coach(out)[0];
    expect(m).toMatchObject({ reason: 'wrapup', blocked: false });
    expect(m.text).toContain('hydrochloric');
  });

  it('refuses to wrap up (and discloses nothing) until the lesson service says the analysis was submitted', async () => {
    const { s, seen, out } = setup('Tube 1 held hydrochloric acid.', { submitted: false });
    await s.handle({ type: 'reveal', snapshot });
    expect(seen).toHaveLength(0);
    expect(coach(out)).toHaveLength(0);
  });

  it('fails closed when the answers cannot be loaded: verdict claims are still blocked', async () => {
    const { s, out } = setup('Tube 2 is neutral, I think.', { assignment: null });
    await s.handle({ type: 'ask', text: 'what is tube 2?', snapshot });
    expect(coach(out)[0].blocked).toBe(true);
  });

  it('never trusts a browser-supplied reveal payload', async () => {
    const { s, seen } = setup('Hello', { submitted: false });
    await s.handle({ type: 'reveal', snapshot, truth: [{ tube: 1, name: 'Hydrochloric Acid', formula: 'HCl', type: 'acid', ph: 1 }] } as never);
    expect(seen).toHaveLength(0);
  });

  it('keeps a bounded conversation history', async () => {
    const { s, seen } = setup('Okay?');
    for (let i = 0; i < 15; i++) await s.handle({ type: 'ask', text: `q${i}`, snapshot });
    expect(seen[seen.length - 1].turns.length).toBeLessThanOrEqual(21);
  });
});

describe('metals lab', () => {
  const metals: Assignment['tubes'] = [
    { tube: 1, id: 'graphite', name: 'Graphite', formula: 'C', type: 'non-metal', ph: 0, facts: 'hammer: shatters, electricity: glows. A non-metal that conducts because of free-moving electrons.' },
    { tube: 2, id: 'iron', name: 'Iron', formula: 'Fe', type: 'metal', ph: 0, facts: 'a typical metal' },
  ];
  const snap: Snapshot = { phase: 'testing', tools: [], activeTool: null, tubes: [], lines: ['Sample 1 (dark grey, dull, solid): first impression metal; Electrical conductivity: predicted "Stays dark", saw "Lights up" (not as predicted).'], claims: [{ n: 1, verdict: 'metal' }] };
  const mk = (reply: string, submitted = false) => setup(reply, { assignment: { submitted, tubes: metals } });

  it('reads the lab state from lines and never sends the hidden results before submission', async () => {
    const { s, seen } = mk('What did you expect the circuit to do, and why?');
    await s.handle({ type: 'ask', text: 'what is sample 1?', snapshot: snap });
    const sent = JSON.stringify(seen[0]);
    expect(sent).toContain('Lights up');
    for (const secret of ['Graphite', 'Iron', 'free-moving', 'shatters']) expect(sent).not.toContain(secret);
  });

  it('blocks a sample verdict but lets the coach repeat the student\'s own call', async () => {
    const leak = mk('Sample 1 is a non-metal, so keep going.');
    await leak.s.handle({ type: 'ask', text: 'tell me', snapshot: snap });
    expect(coach(leak.out)[0].blocked).toBe(true);
    const echo = mk('You called sample 1 a metal. What made you sure?');
    await echo.s.handle({ type: 'ask', text: 'why?', snapshot: snap });
    expect(coach(echo.out)[0].blocked).toBe(false);
  });

  it('after submission the wrap-up gets each sample\'s facts', async () => {
    const { s, seen, out } = mk('Graphite conducts because its carbon atoms form sheets with free electrons.', true);
    await s.handle({ type: 'reveal', snapshot: snap });
    expect(seen[0].system).toContain('Sample 1: Graphite (C), a non-metal.');
    expect(seen[0].system).toContain('free-moving electrons');
    expect(coach(out)[0]).toMatchObject({ reason: 'wrapup', blocked: false });
  });
});

describe('digestive-system journey', () => {
  const stops: Assignment['tubes'] = [
    { tube: 1, id: 'mouth', name: 'Mouth', formula: '', type: '', ph: 0, facts: 'Saliva has amylase that breaks starch into sugars.', terms: ['saliva', 'amylase', 'starch'], open: false },
    { tube: 2, id: 'stomach', name: 'Stomach', formula: '', type: '', ph: 0, facts: 'Gastric juice has HCl and pepsin for proteins.', terms: ['pepsin', 'hcl', 'gastric juice'], open: true },
  ];
  const snap: Snapshot = { phase: 'predict', tools: [], activeTool: null, tubes: [], lines: ['Stop 2 (Stomach): question: "What juices are secreted here?" — no prediction yet; no explanation yet; not yet revealed.'] };
  const mk = (reply: string, submitted = false) => setup(reply, { assignment: { submitted, tubes: stops } });

  it('only guards stops that are still unanswered', async () => {
    const leak = mk('Pepsin is the enzyme at this stop.');
    await leak.s.handle({ type: 'ask', text: 'help', snapshot: snap });
    expect(coach(leak.out)[0].blocked).toBe(true);
    const fine = mk('Earlier you met saliva and amylase. What do you think works on proteins?');
    await fine.s.handle({ type: 'ask', text: 'help', snapshot: snap });
    expect(coach(fine.out)[0].blocked).toBe(false); // the mouth answer was already revealed
  });

  it('wrap-up uses stop facts only after the challenge is submitted', async () => {
    const early = mk('Anything', false);
    await early.s.handle({ type: 'reveal', snapshot: snap });
    expect(early.seen).toHaveLength(0);
    const done = mk('Saliva has amylase, and gastric juice has pepsin and HCl.', true);
    await done.s.handle({ type: 'hello', lessonId: 'biology-101', title: 'The Human Digestive System', labType: 'biology_digestive_system' });
    await done.s.handle({ type: 'reveal', snapshot: snap });
    expect(done.seen[0].system).toContain('Stop 2 (Stomach): Gastric juice has HCl and pepsin');
    expect(coach(done.out)[0]).toMatchObject({ reason: 'wrapup', blocked: false });
  });
});

describe('motion sandbox', () => {
  it('tells the coach not to reveal outcomes, and lists explanations only at wrap-up', async () => {
    const { buildSystemPrompt } = await import('../prompt');
    const hello = { type: 'hello', sessionId: 's', studentId: 'u', token: 't', lessonId: 'physics-motion', title: 'Motion', labType: 'physics_mechanics_sandbox' } as never;
    expect(buildSystemPrompt(hello, null)).toContain('motion, forces and gravitation sandbox');
    const wrap = buildSystemPrompt(hello, [{ tube: 2, id: 'kin_2', name: 'kin_2', formula: '', type: '', ph: 0, facts: 'Displacement is zero after a lap.', terms: ['zero displacement'], open: false }]);
    expect(wrap).toContain('Question 2: Displacement is zero after a lap.');
  });
});
