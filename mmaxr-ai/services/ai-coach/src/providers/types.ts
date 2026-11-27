export type ProviderName = 'anthropic' | 'openai' | 'gemini';
export const PROVIDER_NAMES: ProviderName[] = ['anthropic', 'openai', 'gemini'];

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface CompletionRequest {
  system: string;
  turns: ChatTurn[];
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LlmProvider {
  readonly name: ProviderName;
  readonly model: string;
  isConfigured(): boolean;
  complete(req: CompletionRequest): Promise<string>;
  /**
   * The reply as it is written, in text pieces, so the coach can guard and speak each sentence without waiting for the
   * rest. Optional: a provider without it is called through `complete`.
   */
  stream?(req: CompletionRequest): AsyncIterable<string>;
}

export type ProviderErrorKind = 'not_configured' | 'auth' | 'billing' | 'rate_limit' | 'network' | 'timeout' | 'bad_response';

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
  text(): Promise<string>;
  body?: ReadableStream<Uint8Array> | null;
}>;

/** Providers want strictly alternating turns that start and end with the user. */
export function normalizeTurns(turns: ChatTurn[]): ChatTurn[] {
  const merged: ChatTurn[] = [];
  for (const t of turns) {
    const text = t.text.trim();
    if (!text) continue;
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) last.text += `\n${text}`;
    else merged.push({ role: t.role, text });
  }
  while (merged.length && merged[0].role !== 'user') merged.shift();
  while (merged.length && merged[merged.length - 1].role !== 'user') merged.pop();
  return merged;
}

export const REQUEST_TIMEOUT_MS = 15000;

function providerErrorFor(status: number, detail: string): ProviderError {
  if (status === 401 || status === 403) return new ProviderError('auth', `Provider rejected the API key (${status}). ${detail}`, status);
  if (status === 402 || /credit|billing|quota|insufficient/i.test(detail)) return new ProviderError('billing', `Provider account has no credit or quota (${status}). ${detail}`, status);
  if (status === 429) return new ProviderError('rate_limit', 'Provider rate limit hit', status);
  return new ProviderError('bad_response', `Provider answered ${status}. ${detail}`, status);
}

export interface SseEvent {
  event: string;
  data: string;
}

/**
 * POST JSON and read the answer as server-sent events. The timeout covers the wait for the first byte and every gap
 * between pieces (not the whole reply), so a slow but steady stream is not cut off.
 */
export async function* postStream(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, outer?: AbortSignal): AsyncGenerator<SseEvent> {
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  };
  if (outer?.aborted) ctrl.abort();
  else outer?.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) throw providerErrorFor(res.status, (await res.text().catch(() => '')).slice(0, 300));
    if (!res.body) throw new ProviderError('bad_response', 'Provider sent no stream');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      touch();
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let cut: number;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        let event = 'message';
        const data: string[] = [];
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (data.length) yield { event, data: data.join('\n') };
      }
    }
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if ((err as Error).name === 'AbortError' || ctrl.signal.aborted) throw new ProviderError('timeout', outer?.aborted ? 'Request cancelled' : 'Provider timed out');
    throw new ProviderError('network', `Could not reach the provider: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
    ctrl.abort();
  }
}

/** POST JSON with a timeout; maps HTTP and network failures to ProviderError without ever echoing request headers. */
export async function postJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, outer?: AbortSignal): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  if (outer?.aborted) ctrl.abort();
  else outer?.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) throw providerErrorFor(res.status, (await res.text().catch(() => '')).slice(0, 300));
    return await res.json();
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if ((err as Error).name === 'AbortError') throw new ProviderError('timeout', 'Provider timed out');
    throw new ProviderError('network', `Could not reach the provider: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
