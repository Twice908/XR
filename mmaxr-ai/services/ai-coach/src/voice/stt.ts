import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import type { AudioFormat } from '../protocol';

/** Turns a spoken question into text. One engine serves every session. */
export interface SttEngine {
  readonly name: string;
  available(): boolean;
  /** The words heard, or '' when nothing usable was said. Rejects on failure or when `signal` aborts. */
  transcribe(audio: Uint8Array, format: AudioFormat, signal?: AbortSignal): Promise<string>;
}

export const noStt: SttEngine = {
  name: 'none',
  available: () => false,
  transcribe: () => Promise.reject(new Error('No speech-to-text engine is set up')),
};

export interface WhisperOptions {
  /** whisper.cpp's command-line program (`whisper-cli`). */
  bin: string;
  /** A ggml model, e.g. ggml-base.en.bin. */
  model: string;
  ffmpegBin?: string;
  language?: string;
  /** Longest stretch of a question that is transcribed. */
  maxSeconds?: number;
  timeoutMs?: number;
  threads?: number;
}

/** Runs a program to completion; resolves its stdout. */
function run(bin: string, args: string[], signal: AbortSignal | undefined, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let settled = false;
    const finish = (e: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (e) {
        child.kill('SIGKILL');
        reject(e);
      } else resolve(Buffer.concat(out).toString('utf8'));
    };
    const onAbort = () => finish(new Error('Transcription cancelled'));
    const timer = setTimeout(() => finish(new Error(`${path.basename(bin)} timed out`)), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) return onAbort();
    child.stdout.on('data', (c: Buffer) => out.push(c));
    child.stderr.on('data', (c: Buffer) => err.push(c));
    child.on('error', (e) => finish(new Error(`${path.basename(bin)} failed to start: ${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) finish(null);
      else finish(new Error(`${path.basename(bin)} exited with code ${code}: ${Buffer.concat(err).toString('utf8').trim().slice(-200)}`));
    });
  });
}

/** Whisper writes "[BLANK_AUDIO]", "(music)" and the like for non-speech; those are not words the student said. */
export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]|\([^)]*\)|\*[^*]*\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * whisper.cpp, run locally: free and offline. ffmpeg first turns whatever the browser recorded (WebM/Opus, Ogg, MP4,
 * WAV) into the 16 kHz mono WAV whisper.cpp reads, cut to `maxSeconds`. Files live in a private temp folder that is
 * removed afterwards.
 */
export function createWhisperStt(opts: WhisperOptions): SttEngine {
  const ffmpeg = opts.ffmpegBin ?? 'ffmpeg';
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxSeconds = opts.maxSeconds ?? 30;
  return {
    name: 'whisper.cpp',
    available: () => existsSync(opts.bin) && existsSync(opts.model),
    async transcribe(audio, format, signal) {
      const dir = await mkdtemp(path.join(tmpdir(), 'coach-stt-'));
      try {
        const input = path.join(dir, `question.${format}`);
        const wav = path.join(dir, 'question.wav');
        await writeFile(input, audio);
        await run(ffmpeg, ['-nostdin', '-loglevel', 'error', '-i', input, '-t', String(maxSeconds), '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-y', wav], signal, timeoutMs);
        const args = ['-m', opts.model, '-f', wav, '-l', opts.language ?? 'en', '-nt', '-np'];
        if (opts.threads) args.push('-t', String(opts.threads));
        return cleanTranscript(await run(opts.bin, args, signal, timeoutMs));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

/** Runs at most `max` transcriptions at a time across all sessions (they share the laptop's CPU); the rest wait. */
export function withConcurrency(engine: SttEngine, max = 2): SttEngine {
  let running = 0;
  const queue: (() => void)[] = [];
  return {
    name: engine.name,
    available: () => engine.available(),
    async transcribe(audio, format, signal) {
      if (running >= max) await new Promise<void>((resolve) => queue.push(resolve));
      running++;
      try {
        if (signal?.aborted) throw new Error('Transcription cancelled');
        return await engine.transcribe(audio, format, signal);
      } finally {
        running--;
        queue.shift()?.();
      }
    },
  };
}

/** Picks the engine from the environment: whisper.cpp when WHISPER_BIN and WHISPER_MODEL are set, otherwise none. */
export function createStt(env: NodeJS.ProcessEnv): SttEngine {
  const bin = env.WHISPER_BIN?.trim();
  const model = env.WHISPER_MODEL?.trim();
  if (!bin || !model) return noStt;
  const threads = Number(env.WHISPER_THREADS);
  return withConcurrency(
    createWhisperStt({ bin, model, ffmpegBin: env.FFMPEG_BIN?.trim() || 'ffmpeg', language: env.WHISPER_LANGUAGE?.trim() || 'en', threads: Number.isFinite(threads) && threads > 0 ? threads : undefined }),
    Math.max(1, Number(env.WHISPER_CONCURRENCY) || 2),
  );
}
