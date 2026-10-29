import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompleteOptions, CompleteResult, LlmProvider, LLM_REQUEST_TIMEOUT_MS } from '../llm-provider.interface';

// Gemini models think before answering, and the thinking counts against this
// limit: too low and a review comes back cut off or empty. The thinking
// settings below keep that share (and the cost) small.
const MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_THINKING_BUDGET = 1024;
const DEFAULT_THINKING_LEVEL = 'low';
const DEFAULT_MODEL = 'gemini-3.8-flash';

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';

  constructor(private readonly config: ConfigService) {}

  async complete(prompt: string, opts?: CompleteOptions): Promise<CompleteResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured on the server');
    }
    const baseModel = this.config.get<string>('GEMINI_MODEL') || DEFAULT_MODEL;
    const model = opts?.escalate ? this.config.get<string>('GEMINI_ESCALATION_MODEL') || baseModel : baseModel;
    const thinkingConfig = this.thinkingConfig(model);

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      signal: AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS),
      // A header keeps the key out of URLs — query strings are far more
      // likely to end up in access logs, proxies, or error messages.
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          ...(thinkingConfig ? { thinkingConfig } : {}),
          // Only when the caller actually wants structured output
          // (completeStructured) — forcing this for completeText's
          // free-form callers would wrap plain prose in an unwanted shape.
          ...(opts?.jsonMode ? { responseMimeType: 'application/json' } : {}),
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${text}`);
    }

    const data = (await response.json()) as GeminiResponse;
    const candidate = data.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('\n');
    if (!text.trim()) {
      const why = data.promptFeedback?.blockReason
        ? `the request was blocked (${data.promptFeedback.blockReason})`
        : candidate?.finishReason === 'MAX_TOKENS'
          ? 'it ran out of output tokens before answering'
          : `it returned no text (${candidate?.finishReason ?? 'no candidates'})`;
      throw new Error(`Gemini API error: ${why}`);
    }

    return {
      text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        // Thinking is billed as output.
        outputTokens: (data.usageMetadata?.candidatesTokenCount ?? 0) + (data.usageMetadata?.thoughtsTokenCount ?? 0),
      },
    };
  }

  /**
   * How much the model may think before answering. Gemini 2.5 takes a token
   * budget (2.5 Pro can't turn thinking off, so at least 128); Gemini 3 and
   * later take a level. "low" is plenty for a focused code review.
   */
  private thinkingConfig(model: string): Record<string, unknown> | null {
    if (/^gemini-2\.5/.test(model)) {
      const budget = Number(this.config.get<string>('GEMINI_THINKING_BUDGET'));
      const tokens = Number.isFinite(budget) && budget >= 0 ? budget : DEFAULT_THINKING_BUDGET;
      return { thinkingBudget: /pro/.test(model) ? Math.max(tokens, 128) : tokens };
    }
    if (/^gemini-([3-9]|\d{2})/.test(model)) {
      return { thinkingLevel: this.config.get<string>('GEMINI_THINKING_LEVEL') || DEFAULT_THINKING_LEVEL };
    }
    return null;
  }
}
