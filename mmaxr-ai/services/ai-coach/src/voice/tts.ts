import { spawn } from 'child_process';
import { existsSync } from 'fs';

/** Turns text into speech. One engine serves every session. */
export interface TtsEngine {
  readonly name: string;
  available(): boolean;
  /** MP3 bytes for `text`. Rejects on failure or when `signal` aborts. */
  synthesize(text: string, signal?: AbortSignal): Promise<Uint8Array>;
}

/** No speech: replies stay text-only. Used when no engine is set up. */
export const noTts: TtsEngine = {
  name: 'none',
  available: () => false,
  synthesize: () => Promise.reject(new Error('No text-to-speech engine is set up')),
};

export interface PiperOptions {
  /** The Piper program (github.com/rhasspy/piper). */
  bin: string;
  /** The voice model (.onnx), with its .onnx.json beside it. Same voice as the lab narration by default. */
  model: string;
  /** The voice's sample rate (its .onnx.json `audio.sample_rate`). 22050 for "medium" voices. */
  sampleRate?: number;
  /** MP3 encoder (lame). */
  lameBin?: string;
  timeoutMs?: number;
}

/**
 * Piper, run locally: free, offline, the lab narration's voice. Piper writes raw 16-bit mono PCM, which lame encodes
 * to 64 kbps mono MP3 (the narration's format). Text goes in on stdin, never on the command line.
 */
export function createPiperTts(opts: PiperOptions): TtsEngine {
  const rate = opts.sampleRate ?? 22050;
  const lame = opts.lameBin ?? 'lame';
  const timeoutMs = opts.timeoutMs ?? 15_000;
  return {
    name: 'piper',
    available: () => existsSync(opts.bin) && existsSync(opts.model),
    synthesize(text, signal) {
      return new Promise<Uint8Array>((resolve, reject) => {
        const piper = spawn(opts.bin, ['--model', opts.model, '--output_raw'], { stdio: ['pipe', 'pipe', 'ignore'] });
        const enc = spawn(lame, ['-r', '-s', String(rate / 1000), '-m', 'm', '--bitwidth', '16', '--signed', '--little-endian', '-b', '64', '--quiet', '-', '-'], { stdio: ['pipe', 'pipe', 'ignore'] });
        const chunks: Buffer[] = [];
        let settled = false;
        const finish = (err: Error | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          if (err) {
            piper.kill('SIGKILL');
            enc.kill('SIGKILL');
            reject(err);
          } else resolve(new Uint8Array(Buffer.concat(chunks)));
        };
        const onAbort = () => finish(new Error('Speech cancelled'));
        const timer = setTimeout(() => finish(new Error('Speech timed out')), timeoutMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) return onAbort();

        piper.on('error', (e) => finish(new Error(`Piper failed to start: ${e.message}`)));
        enc.on('error', (e) => finish(new Error(`lame failed to start: ${e.message}`)));
        piper.stdout.pipe(enc.stdin);
        piper.stdin.on('error', () => undefined);
        enc.stdin.on('error', () => undefined);
        piper.on('close', (code) => {
          if (code !== 0) finish(new Error(`Piper exited with code ${code}`));
        });
        enc.stdout.on('data', (c: Buffer) => chunks.push(c));
        enc.on('close', (code) => {
          if (code !== 0) return finish(new Error(`lame exited with code ${code}`));
          if (!chunks.length) return finish(new Error('Speech came out empty'));
          finish(null);
        });
        piper.stdin.end(`${text.replace(/\s+/g, ' ').trim()}\n`);
      });
    },
  };
}

/** Remembers recent sentences, so a repeated line (the fallback prompts, a greeting) is synthesized once. */
export function withCache(engine: TtsEngine, maxEntries = 200): TtsEngine {
  const cache = new Map<string, Uint8Array>();
  return {
    name: engine.name,
    available: () => engine.available(),
    async synthesize(text, signal) {
      const hit = cache.get(text);
      if (hit) {
        cache.delete(text);
        cache.set(text, hit);
        return hit;
      }
      const audio = await engine.synthesize(text, signal);
      cache.set(text, audio);
      if (cache.size > maxEntries) cache.delete(cache.keys().next().value as string);
      return audio;
    },
  };
}

/** Picks the engine from the environment: Piper when PIPER_BIN and PIPER_MODEL are set, otherwise none. */
export function createTts(env: NodeJS.ProcessEnv): TtsEngine {
  const bin = env.PIPER_BIN?.trim();
  const model = env.PIPER_MODEL?.trim();
  if (!bin || !model) return noTts;
  const rate = Number(env.PIPER_SAMPLE_RATE);
  return withCache(createPiperTts({ bin, model, sampleRate: Number.isFinite(rate) && rate > 0 ? rate : 22050, lameBin: env.LAME_BIN?.trim() || 'lame' }));
}
