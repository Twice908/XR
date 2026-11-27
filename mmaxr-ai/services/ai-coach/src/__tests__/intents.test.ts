import { describe, expect, it } from 'vitest';
import { matchIntent } from '../intents';
import { CoachSession } from '../session';
import type { CompletionRequest, LlmProvider, ProviderName, ProviderRegistry } from '../providers';
import type { ServerMessage, Snapshot } from '../protocol';
import type { TtsEngine } from '../voice/tts';

describe('matchIntent', () => {
  it('recognises "say that again", however it is said', () => {
    for (const t of ['Repeat that', 'say it again please', 'Sorry, what?', 'Pardon?', 'um can you repeat that', 'Coach, say that again.', "I didn't hear that"]) expect(matchIntent(t)).toBe('repeat');
  });
  it('recognises "what do I do now?"', () => {
    for (const t of ['What do I do now?', "what's next", 'What should I do next?', "I'm lost", 'ok what now', 'Where am I?']) expect(matchIntent(t)).toBe('next');
  });
  it('leaves real questions to the model', () => {
    for (const t of ['What do I do with the ammeter?', 'why did it turn red', 'repeat the experiment with more voltage', 'what is the wavelength', 'can you explain what an echo is', 'what next after I clap in the room?', '']) expect(matchIntent(t)).toBeNull();
  });
});

const snapshot: Snapshot = { phase: 'testing', tools: [], activeTool: null, tubes: [] };

function setup(voice = false) {
  const seen: CompletionRequest[] = [];
  const provider: LlmProvider = { name: 'anthropic' as ProviderName, model: 'fake', isConfigured: () => true, complete: async (r) => (seen.push(r), 'What did you expect the echo to do, and why?') };
  const tts: TtsEngine = { name: 'fake', available: () => true, synthesize: async (t) => new TextEncoder().encode(t) };
  const out: ServerMessage[] = [];
  const s = new CoachSession({
    registry: { active: provider } as unknown as ProviderRegistry,
    loadAssignment: async () => null,
    loadContext: async () => ({ context: 'Bench "Echo": a field and a room.', narration: { 'task-echo-1': 'Welcome to the echo bench. Clap in the field, then in the room.' } }),
    tts,
    send: (m) => out.push(m),
  });
  void s.handle({ type: 'hello', lessonId: 'physics-sound', title: 'Sound', labType: 'physics_waves_sound', voice });
  const coach = () => out.filter((m): m is Extract<ServerMessage, { type: 'coach' }> => m.type === 'coach');
  return { s, out, seen, coach };
}

describe('quick answers', () => {
  it('"say that again" repeats the last reply word for word, without the model', async () => {
    const h = setup();
    await h.s.handle({ type: 'ask', text: 'how does an echo work?', snapshot });
    await h.s.handle({ type: 'ask', text: 'Say that again', snapshot });
    expect(h.seen).toHaveLength(1);
    const [first, again] = h.coach();
    expect(again).toMatchObject({ text: first.text, quick: 'repeat', provider: 'none', degraded: false });
  });

  it('"say that again" before anything was said gets a friendly line', async () => {
    const h = setup();
    await h.s.handle({ type: 'ask', text: 'pardon?', snapshot });
    expect(h.coach()[0].text).toMatch(/not said anything yet/);
    expect(h.seen).toHaveLength(0);
  });

  it('"what do I do now?" repeats the narration line the student heard last', async () => {
    const h = setup(true);
    await h.s.handle({ type: 'floor', narrating: true, cue: 'task-echo-1' });
    await h.s.handle({ type: 'floor', narrating: false });
    await h.s.handle({ type: 'ask', text: 'What do I do now?', snapshot });
    await new Promise((r) => setTimeout(r, 0));
    expect(h.seen).toHaveLength(0);
    expect(h.coach()[0]).toMatchObject({ text: 'Welcome to the echo bench. Clap in the field, then in the room.', quick: 'next', voice: true });
    expect(h.out.some((m) => m.type === 'coach_audio')).toBe(true);
  });

  it('"what do I do now?" goes to the model when no narration has played yet', async () => {
    const h = setup();
    await h.s.handle({ type: 'ask', text: 'what now?', snapshot });
    expect(h.seen).toHaveLength(1);
    expect(h.coach()[0].quick).toBeUndefined();
  });

  it('ignores a malformed cue', async () => {
    const h = setup();
    await h.s.handle({ type: 'floor', narrating: true, cue: '../../etc/passwd' });
    await h.s.handle({ type: 'ask', text: 'what now?', snapshot });
    expect(h.seen).toHaveLength(1);
  });

  it('a quick answer replaces a reply still in progress, and stays silent when the coach is off', async () => {
    const h = setup();
    await h.s.handle({ type: 'mode', mode: 'off' });
    await h.s.handle({ type: 'ask', text: 'repeat that', snapshot });
    expect(h.out.some((m) => m.type === 'coach_off')).toBe(true);
    expect(h.coach()).toHaveLength(0);
  });
});
