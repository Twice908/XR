import { ProviderError, normalizeTurns, postJson, type CompletionRequest, type FetchLike, type LlmProvider } from './types';

export function createGemini(env: NodeJS.ProcessEnv, fetchImpl: FetchLike = fetch as unknown as FetchLike): LlmProvider {
  const key = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim() || '';
  const model = env.GEMINI_MODEL?.trim() || 'gemini-2.0-flash';
  return {
    name: 'gemini',
    model,
    isConfigured: () => key.length > 0,
    async complete(req: CompletionRequest) {
      if (!key) throw new ProviderError('not_configured', 'No Gemini key set (GEMINI_API_KEY)');
      const data = await postJson(
        fetchImpl,
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { 'x-goog-api-key': key },
        {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: normalizeTurns(req.turns).map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] })),
          generationConfig: { maxOutputTokens: req.maxTokens ?? 220, temperature: 0.4 },
        },
        req.signal,
      );
      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('');
      if (typeof text !== 'string' || !text.trim()) throw new ProviderError('bad_response', 'Gemini returned no text');
      return text.trim();
    },
  };
}
