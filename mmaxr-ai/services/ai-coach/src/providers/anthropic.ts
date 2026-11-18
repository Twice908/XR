import { ProviderError, normalizeTurns, postJson, type CompletionRequest, type FetchLike, type LlmProvider } from './types';

export function createAnthropic(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = fetch as unknown as FetchLike): LlmProvider {
  const key = env.CLAUDE_API_KEY?.trim() || env.ANTHROPIC_API_KEY?.trim() || '';
  const model = env.ANTHROPIC_MODEL?.trim() || 'claude-haiku-5-5';
  return {
    name: 'anthropic',
    model,
    isConfigured: () => key.length > 0,
    async complete(req: CompletionRequest) {
      if (!key) throw new ProviderError('not_configured', 'No Anthropic key set (CLAUDE_API_KEY)');
      const data = await postJson(
        fetchImpl,
        'https://api.anthropic.com/v1/messages',
        { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        { model, max_tokens: req.maxTokens ?? 220, temperature: 0.4, system: req.system, messages: normalizeTurns(req.turns).map((t) => ({ role: t.role, content: t.text })) },
        req.signal,
      );
      const text = Array.isArray(data?.content) ? data.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') : '';
      if (!text.trim()) throw new ProviderError('bad_response', 'Anthropic returned no text');
      return text.trim();
    },
  };
}
