import { ProviderError, normalizeTurns, postJson, type CompletionRequest, type FetchLike, type LlmProvider } from './types';

export function createOpenAI(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = fetch as unknown as FetchLike): LlmProvider {
  const key = env.OPENAI_API_KEY?.trim() || '';
  const model = env.OPENAI_MODEL?.trim() || 'gpt-4.1-mini';
  const base = (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
  return {
    name: 'openai',
    model,
    isConfigured: () => key.length > 0,
    async complete(req: CompletionRequest) {
      if (!key) throw new ProviderError('not_configured', 'No OpenAI key set (OPENAI_API_KEY)');
      const data = await postJson(
        fetchImpl,
        `${base}/chat/completions`,
        { authorization: `Bearer ${key}` },
        {
          model,
          max_completion_tokens: req.maxTokens ?? 220,
          temperature: 0.4,
          messages: [{ role: 'system', content: req.system }, ...normalizeTurns(req.turns).map((t) => ({ role: t.role, content: t.text }))],
        },
        req.signal,
      );
      const text = data?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new ProviderError('bad_response', 'OpenAI returned no text');
      return text.trim();
    },
  };
}
