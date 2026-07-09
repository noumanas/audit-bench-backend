import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { LlmProvider } from './llm-provider.interface';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { LlmProviderName } from '../common/types';

function extractJson(raw: string): string {
  const withoutFences = raw.replace(/```json|```/gi, '').trim();
  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return withoutFences;
  return withoutFences.slice(start, end + 1);
}

@Injectable()
export class LlmService {
  private readonly providers: Record<LlmProviderName, LlmProvider>;

  constructor(
    private readonly config: ConfigService,
    anthropic: AnthropicProvider,
    openai: OpenAiProvider,
    gemini: GeminiProvider,
  ) {
    this.providers = { anthropic, openai, gemini };
  }

  resolveProvider(requested?: string): LlmProviderName {
    const fallback = (this.config.get<string>('DEFAULT_LLM_PROVIDER') || 'anthropic') as LlmProviderName;
    if (requested && requested in this.providers) return requested as LlmProviderName;
    return fallback;
  }

  /** Whether an escalation model is configured for this provider — if not, escalating would just re-run the same model for no benefit. */
  hasEscalationModel(providerName: LlmProviderName): boolean {
    return Boolean(this.config.get<string>(`${providerName.toUpperCase()}_ESCALATION_MODEL`));
  }

  /**
   * Calls the given provider and parses+validates its response against `schema`.
   * Retries once with a stricter follow-up if the first response isn't valid JSON,
   * since LLMs occasionally wrap output in prose despite instructions.
   */
  async completeStructured<T>(
    providerName: LlmProviderName,
    prompt: string,
    schema: z.ZodType<T>,
    opts?: { escalate?: boolean },
  ): Promise<T> {
    const provider = this.providers[providerName];

    const attempt = async (p: string) => {
      const raw = await provider.complete(p, opts);
      const json = JSON.parse(extractJson(raw));
      return schema.parse(json);
    };

    try {
      return await attempt(prompt);
    } catch {
      const repairPrompt = `${prompt}\n\nYour previous response could not be parsed. Return ONLY a single valid JSON object matching the required shape — no markdown fences, no commentary, no trailing text.`;
      return attempt(repairPrompt);
    }
  }
}
