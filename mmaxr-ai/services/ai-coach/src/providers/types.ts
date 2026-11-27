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

/** POST JSON with a timeout; maps HTTP and network failures to ProviderError without ever echoing request headers. */
export async function postJson(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, outer?: AbortSignal): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  if (outer?.aborted) ctrl.abort();
  else outer?.addEventListener('abort', () => ctrl.abort(), { once: true });
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      if (res.status === 401 || res.status === 403) throw new ProviderError('auth', `Provider rejected the API key (${res.status}). ${detail}`, res.status);
      if (res.status === 402 || /credit|billing|quota|insufficient/i.test(detail)) throw new ProviderError('billing', `Provider account has no credit or quota (${res.status}). ${detail}`, res.status);
      if (res.status === 429) throw new ProviderError('rate_limit', 'Provider rate limit hit', res.status);
      throw new ProviderError('bad_response', `Provider answered ${res.status}. ${detail}`, res.status);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if ((err as Error).name === 'AbortError') throw new ProviderError('timeout', 'Provider timed out');
    throw new ProviderError('network', `Could not reach the provider: ${(err as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
