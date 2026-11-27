import { describe, expect, it } from 'vitest';
import { ProviderRegistry, ProviderError, normalizeTurns, type FetchLike } from '../providers';

const ok = (body: unknown): FetchLike => async () => ({ ok: true, status: 200, json: async () => body, text: async () => '' });
const fail = (status: number, text = ''): FetchLike => async () => ({ ok: false, status, json: async () => ({}), text: async () => text });
const spy = (body: unknown) => {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => body, text: async () => '' };
  };
  return { f, calls };
};
const req = { system: 'SYS', turns: [{ role: 'user' as const, text: 'hi' }] };

describe('normalizeTurns', () => {
  it('merges same-role turns and starts and ends with the user', () => {
    const out = normalizeTurns([
      { role: 'assistant', text: 'orphan' },
      { role: 'user', text: 'a' },
      { role: 'user', text: 'b' },
      { role: 'assistant', text: 'c' },
    ]);
    expect(out).toEqual([{ role: 'user', text: 'a\nb' }]);
  });
});

describe('providers', () => {
  it('Anthropic: sends the messages API shape and reads text blocks', async () => {
    const { f, calls } = spy({ content: [{ type: 'text', text: 'Hello there' }] });
    const reg = new ProviderRegistry({ CLAUDE_API_KEY: 'k-anthropic' }, f);
    expect(await reg.active.complete(req)).toBe('Hello there');
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0].headers['x-api-key']).toBe('k-anthropic');
    expect(calls[0].headers['anthropic-version']).toBeDefined();
    // The system prompt is one cached block; no sampling settings (current models reject them).
    expect(calls[0].body.system).toEqual([{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }]);
    expect(calls[0].body.temperature).toBeUndefined();
    expect(calls[0].body.output_config).toEqual({ effort: 'low' });
    expect(calls[0].body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('OpenAI: system message first, bearer auth, reads choices', async () => {
    const { f, calls } = spy({ choices: [{ message: { content: ' Hi from GPT ' } }] });
    const reg = new ProviderRegistry({ AI_COACH_PROVIDER: 'openai', OPENAI_API_KEY: 'k-openai' }, f);
    expect(reg.active.name).toBe('openai');
    expect(await reg.active.complete(req)).toBe('Hi from GPT');
    expect(calls[0].headers.authorization).toBe('Bearer k-openai');
    expect(calls[0].body.messages[0]).toEqual({ role: 'system', content: 'SYS' });
  });

  it('Gemini: systemInstruction, model/user roles, reads candidates, key in header not URL', async () => {
    const { f, calls } = spy({ candidates: [{ content: { parts: [{ text: 'Hi from Gemini' }] } }] });
    const reg = new ProviderRegistry({ AI_COACH_PROVIDER: 'gemini', GEMINI_API_KEY: 'k-gem' }, f);
    const out = await reg.active.complete({ system: 'SYS', turns: [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }, { role: 'user', text: 'c' }] });
    expect(out).toBe('Hi from Gemini');
    expect(calls[0].url).not.toContain('k-gem');
    expect(calls[0].headers['x-goog-api-key']).toBe('k-gem');
    expect(calls[0].body.systemInstruction.parts[0].text).toBe('SYS');
    expect(calls[0].body.contents.map((c: any) => c.role)).toEqual(['user', 'model', 'user']);
  });

  it('reports configuration without exposing keys and refuses to call without one', async () => {
    const reg = new ProviderRegistry({ OPENAI_API_KEY: 'secret-value' }, ok({}));
    expect(JSON.stringify(reg.list())).not.toContain('secret-value');
    expect(reg.list().find((p) => p.name === 'openai')!.configured).toBe(true);
    expect(reg.list().find((p) => p.name === 'anthropic')!.configured).toBe(false);
    await expect(reg.active.complete(req)).rejects.toMatchObject({ kind: 'not_configured' });
  });

  it('switches at runtime and rejects unknown names', () => {
    const reg = new ProviderRegistry({});
    expect(reg.active.name).toBe('anthropic');
    expect(reg.set('gemini')).toBe(true);
    expect(reg.active.name).toBe('gemini');
    expect(reg.set('grok')).toBe(false);
    expect(reg.active.name).toBe('gemini');
  });

  it('maps HTTP failures to useful kinds', async () => {
    const mk = (f: FetchLike) => new ProviderRegistry({ CLAUDE_API_KEY: 'k' }, f).active.complete(req);
    await expect(mk(fail(401))).rejects.toMatchObject({ kind: 'auth' });
    await expect(mk(fail(400, 'Your credit balance is too low'))).rejects.toMatchObject({ kind: 'billing' });
    await expect(mk(fail(429))).rejects.toMatchObject({ kind: 'rate_limit' });
    await expect(mk(fail(500))).rejects.toBeInstanceOf(ProviderError);
    await expect(mk(async () => { throw new Error('boom'); })).rejects.toMatchObject({ kind: 'network' });
    await expect(mk(ok({ content: [] }))).rejects.toMatchObject({ kind: 'bad_response' });
  });
});
