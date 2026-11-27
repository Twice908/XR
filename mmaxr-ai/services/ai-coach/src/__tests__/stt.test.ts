import { execFileSync } from 'child_process';
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { CoachSession } from '../session';
import type { CompletionRequest, LlmProvider, ProviderName, ProviderRegistry } from '../providers';
import type { AudioFormat, ServerMessage, Snapshot } from '../protocol';
import { cleanTranscript, createStt, createWhisperStt, withConcurrency, type SttEngine } from '../voice/stt';

describe('stt engine', () => {
  it('drops whisper\'s non-speech markers', () => {
    expect(cleanTranscript(' [BLANK_AUDIO]\n')).toBe('');
    expect(cleanTranscript(' (music) Why did it turn red? [laughs]\n')).toBe('Why did it turn red?');
  });

  it('is off unless whisper.cpp is configured', () => {
    expect(createStt({}).available()).toBe(false);
    expect(createStt({ WHISPER_BIN: '/nope', WHISPER_MODEL: '/nope' }).available()).toBe(false);
  });

  it('runs at most N transcriptions at once', async () => {
    let running = 0;
    let peak = 0;
    const slow: SttEngine = {
      name: 'slow',
      available: () => true,
      transcribe: async () => {
        peak = Math.max(peak, ++running);
        await new Promise((r) => setTimeout(r, 20));
        running--;
        return 'ok';
      },
    };
    const limited = withConcurrency(slow, 2);
    await Promise.all(Array.from({ length: 6 }, () => limited.transcribe(new Uint8Array([1]), 'webm')));
    expect(peak).toBe(2);
  });

  let ffmpeg = true;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    ffmpeg = false;
  }
  it.skipIf(!ffmpeg)('converts the recording to 16 kHz mono WAV for whisper.cpp and returns its text', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'coach-stt-test-'));
    // A stand-in for whisper-cli: checks the WAV header it is given, prints a transcript like whisper does.
    const bin = path.join(dir, 'whisper-cli');
    writeFileSync(
      bin,
      `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
const wav = fs.readFileSync(a[a.indexOf('-f') + 1]);
const channels = wav.readUInt16LE(22), rate = wav.readUInt32LE(24);
if (channels !== 1 || rate !== 16000 || a[a.indexOf('-l') + 1] !== 'en' || !a.includes('-nt')) { console.error('bad input', channels, rate); process.exit(2); }
process.stdout.write(' [BLANK_AUDIO] Why does the echo come back later?\\n');
`,
    );
    chmodSync(bin, 0o755);
    const model = path.join(dir, 'ggml-test.bin');
    writeFileSync(model, '');
    // One second of a tone as browser-style WebM/Opus.
    const webm = path.join(dir, 'q.webm');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libopus', '-y', webm]);
    const stt = createWhisperStt({ bin, model });
    expect(stt.available()).toBe(true);
    expect(await stt.transcribe(new Uint8Array(readFileSync(webm)), 'webm')).toBe('Why does the echo come back later?');
  });

  it.skipIf(!ffmpeg)('fails cleanly on audio ffmpeg cannot read', async () => {
    const stt = createWhisperStt({ bin: '/bin/echo', model: '/bin/echo', timeoutMs: 5000 });
    await expect(stt.transcribe(new Uint8Array([1, 2, 3, 4]), 'webm')).rejects.toThrow(/ffmpeg/);
  });
});

// ---- the session ----

const snapshot: Snapshot = { phase: 'testing', tools: [], activeTool: null, tubes: [] };
const b64 = (s: string) => Buffer.from(s).toString('base64');

function setup(stt: SttEngine | undefined, asksPerMinute = 5) {
  const clock = { t: 1_000_000 };
  const seen: CompletionRequest[] = [];
  const provider: LlmProvider = { name: 'anthropic' as ProviderName, model: 'fake', isConfigured: () => true, complete: async (r) => (seen.push(r), 'What did you notice first?') };
  const out: ServerMessage[] = [];
  const s = new CoachSession({ registry: { active: provider } as unknown as ProviderRegistry, loadAssignment: async () => null, stt, asksPerMinute, send: (m) => out.push(m), now: () => clock.t });
  void s.handle({ type: 'hello', lessonId: 'physics-sound', title: 'Sound', labType: 'physics_waves_sound' });
  const of = <T extends ServerMessage['type']>(type: T) => out.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
  return { s, out, seen, clock, of };
}
const hearing = (heard: string | ((audio: string) => string)): SttEngine => ({
  name: 'fake',
  available: () => true,
  transcribe: async (audio) => (typeof heard === 'function' ? heard(Buffer.from(audio).toString()) : heard),
});

describe('CoachSession audio questions', () => {
  it('says what it heard, then answers it as a spoken question', async () => {
    const h = setup(hearing('Why does the echo come back later?'));
    await h.s.handle({ type: 'audio_ask', format: 'webm', data: b64('audio'), snapshot });
    expect(h.of('transcript')).toEqual([{ type: 'transcript', text: 'Why does the echo come back later?' }]);
    expect(h.out.indexOf(h.of('transcript')[0])).toBeLessThan(h.out.indexOf(h.of('coach')[0]));
    expect(JSON.stringify(h.seen[0].turns)).toContain('Why does the echo come back later?');
  });

  it('a spoken "say that again" is a free quick answer', async () => {
    const h = setup(hearing('Say that again.'));
    await h.s.handle({ type: 'ask', text: 'what is an echo?', snapshot });
    await h.s.handle({ type: 'audio_ask', format: 'ogg', data: b64('audio'), snapshot });
    expect(h.seen).toHaveLength(1);
    expect(h.of('coach')[1].quick).toBe('repeat');
  });

  it('reports silence, failure, a missing engine, oversized and malformed audio without replying', async () => {
    expect((await run(setup(hearing('')), 'webm', b64('x'))).of('transcript')[0].error).toBe('empty');
    const failing: SttEngine = { name: 'f', available: () => true, transcribe: async () => { throw new Error('boom'); } };
    expect((await run(setup(failing), 'webm', b64('x'))).of('transcript')[0].error).toBe('failed');
    expect((await run(setup(undefined), 'webm', b64('x'))).of('transcript')[0].error).toBe('unavailable');
    expect((await run(setup(hearing('hi')), 'webm', 'A'.repeat(3_000_000))).of('transcript')[0].error).toBe('too_large');
    expect((await run(setup(hearing('hi')), 'flac' as AudioFormat, b64('x'))).of('transcript')[0].error).toBe('failed');
    async function run(h: ReturnType<typeof setup>, format: AudioFormat, data: string) {
      await h.s.handle({ type: 'audio_ask', format, data, snapshot });
      expect(h.of('coach')).toHaveLength(0);
      return h;
    }
  });

  it('talking again stops the transcription in progress', async () => {
    let release: (t: string) => void = () => undefined;
    const slow: SttEngine = { name: 's', available: () => true, transcribe: (_a, _f, signal) => new Promise((resolve, reject) => { release = resolve; signal?.addEventListener('abort', () => reject(new Error('aborted'))); }) };
    const h = setup(slow);
    const p = h.s.handle({ type: 'audio_ask', format: 'webm', data: b64('x'), snapshot });
    await new Promise((r) => setTimeout(r, 0));
    await h.s.handle({ type: 'floor', talking: true });
    release('too late');
    await p;
    expect(h.of('transcript')).toHaveLength(0);
    expect(h.of('coach')).toHaveLength(0);
  });

  it('typed and spoken questions share the limit; quick answers stay free', async () => {
    const h = setup(hearing('How loud is it?'), 2);
    await h.s.handle({ type: 'ask', text: 'one?', snapshot });
    await h.s.handle({ type: 'audio_ask', format: 'webm', data: b64('x'), snapshot });
    await h.s.handle({ type: 'ask', text: 'say that again', snapshot });
    await h.s.handle({ type: 'ask', text: 'three?', snapshot });
    expect(h.seen).toHaveLength(2);
    expect(h.of('error')[0].message).toMatch(/2 questions a minute/);
    h.clock.t += 60_000;
    await h.s.handle({ type: 'ask', text: 'four?', snapshot });
    expect(h.seen).toHaveLength(3);
  });

  it('limits how many recordings it transcribes a minute', async () => {
    const h = setup(hearing('say that again'));
    for (let i = 0; i < 11; i++) await h.s.handle({ type: 'audio_ask', format: 'webm', data: b64('x'), snapshot });
    expect(h.of('transcript').filter((t) => t.error === 'limit')).toHaveLength(1);
  });
});
