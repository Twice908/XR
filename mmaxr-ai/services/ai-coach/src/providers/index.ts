import { createAnthropic } from './anthropic';
import { createGemini } from './gemini';
import { createOpenAI } from './openai';
import { PROVIDER_NAMES, type FetchLike, type LlmProvider, type ProviderName } from './types';

export * from './types';

export interface ProviderInfo {
  name: ProviderName;
  model: string;
  configured: boolean;
  active: boolean;
}

/**
 * Holds every provider and which one is active. There is deliberately no automatic fallback
 * to a different provider: the choice is explicit (env var or the admin endpoint).
 */
export class ProviderRegistry {
  private readonly providers: Record<ProviderName, LlmProvider>;
  private current: ProviderName;

  constructor(env: NodeJS.ProcessEnv = process.env, fetchImpl?: FetchLike) {
    this.providers = {
      anthropic: createAnthropic(env, fetchImpl),
      openai: createOpenAI(env, fetchImpl),
      gemini: createGemini(env, fetchImpl),
    };
    const wanted = (env.AI_COACH_PROVIDER ?? 'anthropic').trim().toLowerCase();
    this.current = (PROVIDER_NAMES as string[]).includes(wanted) ? (wanted as ProviderName) : 'anthropic';
  }

  get active(): LlmProvider {
    return this.providers[this.current];
  }

  set(name: string): boolean {
    if (!(PROVIDER_NAMES as string[]).includes(name)) return false;
    this.current = name as ProviderName;
    return true;
  }

  list(): ProviderInfo[] {
    return PROVIDER_NAMES.map((n) => ({ name: n, model: this.providers[n].model, configured: this.providers[n].isConfigured(), active: n === this.current }));
  }
}
