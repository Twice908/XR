import { ProviderError, normalizeTurns, postJson, postStream, type CompletionRequest, type FetchLike, type LlmProvider } from './types';

/**
 * Claude over the Messages API.
 *
 * - The system prompt (coaching rules plus the lab's public context, which is loaded once per session) is marked for
 *   prompt caching, so after the first question it is read from the cache instead of billed again as fresh input.
 * - No `temperature`: current models reject non-default sampling values.
 * - Effort `low`: replies are one to three spoken sentences, and thinking must not use up the small output budget,
 *   so `max_tokens` gets headroom above the reply length the prompt asks for.
 * - `stream` reads the same request as server-sent events and yields only text (thinking pieces are skipped).
 */
export function createAnthropic(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = fetch as unknown as FetchLike): LlmProvider {
  const key = env.CLAUDE_API_KEY?.trim() || env.ANTHROPIC_API_KEY?.trim() || '';
  const model = env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-5-5';
  const url = `${(env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com').replace(/\/$/, '')}/v1/messages`;
  const body = (req: CompletionRequest) => ({
    model,
    max_tokens: Math.max(1024, (req.maxTokens ?? 220) * 4),
    output_config: { effort: 'low' },
    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
    messages: normalizeTurns(req.turns).map((t) => ({ role: t.role, content: t.text })),
  });
  const headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
  return {
    name: 'anthropic',
    model,
    isConfigured: () => key.length > 0,
    async complete(req: CompletionRequest) {
      if (!key) throw new ProviderError('not_configured', 'No Anthropic key set (CLAUDE_API_KEY)');
      const data = await postJson(fetchImpl, url, headers, body(req), req.signal);
      if (data?.stop_reason === 'refusal') throw new ProviderError('bad_response', 'Anthropic declined to answer');
      const text = Array.isArray(data?.content) ? data.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') : '';
      if (!text.trim()) throw new ProviderError('bad_response', 'Anthropic returned no text');
      return text.trim();
    },
    async *stream(req: CompletionRequest) {
      if (!key) throw new ProviderError('not_configured', 'No Anthropic key set (CLAUDE_API_KEY)');
      for await (const ev of postStream(fetchImpl, url, headers, { ...body(req), stream: true }, req.signal)) {
        if (ev.data === '[DONE]') return;
        let data: any;
        try {
          data = JSON.parse(ev.data);
        } catch {
          continue;
        }
        if (data?.type === 'error' || ev.event === 'error') throw new ProviderError('bad_response', `Anthropic stream error: ${String(data?.error?.message ?? 'unknown').slice(0, 200)}`);
        if (data?.type === 'content_block_delta' && data.delta?.type === 'text_delta' && typeof data.delta.text === 'string') yield data.delta.text;
        if (data?.type === 'message_delta' && data.delta?.stop_reason === 'refusal') throw new ProviderError('bad_response', 'Anthropic declined to answer');
        if (data?.type === 'message_stop') return;
      }
    },
  };
}
