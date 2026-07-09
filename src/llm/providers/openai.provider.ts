import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompleteOptions, LlmProvider } from '../llm-provider.interface';

// Reasoning-capable models (o-series, gpt-5 family) spend part of this
// budget on hidden reasoning tokens before writing visible output — how
// much scales with prompt complexity, so a fixed cap alone can't fully
// prevent truncation. reasoning_effort:'low' keeps that overhead small;
// this cap is just headroom on top of that for the actual JSON payload.
const MAX_OUTPUT_TOKENS = 6000;

@Injectable()
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';

  constructor(private readonly config: ConfigService) {}

  async complete(prompt: string, opts?: CompleteOptions): Promise<string> {
    const apiKey = this.config.get<string>('OPENAI_API_KEY');
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not configured on the server');
    }
    const baseModel = this.config.get<string>('OPENAI_MODEL') || 'gpt-5-mini';
    const model = opts?.escalate ? this.config.get<string>('OPENAI_ESCALATION_MODEL') || baseModel : baseModel;

    let response = await this.request(apiKey, model, prompt, true);

    if (!response.ok && response.status === 400) {
      const body = await response.clone().text();
      if (body.includes('reasoning_effort')) {
        // Model doesn't support the param (e.g. a non-reasoning model) — retry without it.
        response = await this.request(apiKey, model, prompt, false);
      }
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${text}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    if (choice?.finish_reason === 'length') {
      throw new Error(
        'OpenAI response was truncated before completing (hit the output token limit) — the model spent its budget on internal reasoning for this prompt',
      );
    }

    return choice?.message?.content ?? '';
  }

  private request(apiKey: string, model: string, prompt: string, withReasoningEffort: boolean) {
    return fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        // Caps runaway generations, and forcing valid JSON avoids the
        // llm.service.ts repair-retry path silently doubling request cost.
        max_completion_tokens: MAX_OUTPUT_TOKENS,
        response_format: { type: 'json_object' },
        ...(withReasoningEffort ? { reasoning_effort: 'low' } : {}),
      }),
    });
  }
}
