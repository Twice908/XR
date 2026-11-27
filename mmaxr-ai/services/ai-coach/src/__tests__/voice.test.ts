import { execFileSync } from 'child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { RateWindow } from '../rateLimit';
import { splitSentences } from '../voice/sentences';
import { createPiperTts, createTts, noTts, withCache, type TtsEngine } from '../voice/tts';

describe('splitSentences', () => {
  it('splits a reply into sentences', () => {
    expect(splitSentences('You saw the litmus turn red. What did you expect before you tested it? Why?')).toEqual([
      'You saw the litmus turn red.',
      'What did you expect before you tested it? Why?',
    ]);
  });
  it('joins very short pieces to a neighbour and keeps decimals whole', () => {
    expect(splitSentences('Good. The reading was 0.5 A at 2 V, so what changes at 4 V?')).toEqual(['Good. The reading was 0.5 A at 2 V, so what changes at 4 V?']);
    expect(splitSentences('Nice.')).toEqual(['Nice.']);
    expect(splitSentences('  ')).toEqual([]);
  });
});

describe('RateWindow', () => {
  it('allows the limit per minute, then refuses until the window resets', () => {
    const clock = { t: 0 };
    const w = new RateWindow(5, () => clock.t);
    for (let i = 0; i < 5; i++) expect(w.take()).toBe(true);
    expect(w.take()).toBe(false);
    clock.t = 30_000;
    expect(w.take()).toBe(false);
    expect(w.secondsLeft()).toBe(30);
    clock.t = 60_000;
    expect(w.take()).toBe(true);
  });
});

describe('tts', () => {
  it('has no engine unless Piper is configured', () => {
    expect(createTts({}).available()).toBe(false);
    expect(createTts({ PIPER_BIN: '/nope/piper', PIPER_MODEL: '/nope/voice.onnx' }).available()).toBe(false);
    return expect(noTts.synthesize('hi')).rejects.toThrow();
  });

  it('caches repeated sentences', async () => {
    let calls = 0;
    const base: TtsEngine = { name: 'fake', available: () => true, synthesize: async (t) => (calls++, new TextEncoder().encode(t)) };
    const cached = withCache(base, 2);
    await cached.synthesize('a');
    await cached.synthesize('a');
    expect(calls).toBe(1);
    await cached.synthesize('b');
    await cached.synthesize('c');
    await cached.synthesize('a'); // evicted by b and c
    expect(calls).toBe(4);
  });

  let lame = true;
  try {
    execFileSync('lame', ['--version'], { stdio: 'ignore' });
  } catch {
    lame = false;
  }
  it.skipIf(!lame)('runs Piper and encodes its raw audio to MP3', async () => {
    // A stand-in for Piper: reads the text, writes one second of raw 16-bit silence.
    const dir = mkdtempSync(path.join(tmpdir(), 'coach-tts-'));
    const bin = path.join(dir, 'piper');
    writeFileSync(bin, '#!/bin/sh\ncat > /dev/null\nhead -c 44100 /dev/zero\n');
    chmodSync(bin, 0o755);
    const model = path.join(dir, 'voice.onnx');
    writeFileSync(model, '');
    const tts = createPiperTts({ bin, model });
    expect(tts.available()).toBe(true);
    const mp3 = await tts.synthesize('Hello there.');
    expect(mp3.byteLength).toBeGreaterThan(500);
    const head = Buffer.from(mp3.subarray(0, 3));
    expect(head.toString('latin1') === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)).toBe(true);
  });

  it('reports a Piper failure instead of hanging', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'coach-tts-'));
    const bin = path.join(dir, 'piper');
    writeFileSync(bin, '#!/bin/sh\nexit 3\n');
    chmodSync(bin, 0o755);
    await expect(createPiperTts({ bin, model: bin, timeoutMs: 3000 }).synthesize('Hi.')).rejects.toThrow();
  });
});
