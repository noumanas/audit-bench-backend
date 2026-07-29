import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompleteOptions, CompleteResult, LlmProvider } from '../llm-provider.interface';

const MAX_OUTPUT_TOKENS = 2000;

@Injectable()
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';

  constructor(private readonly config: ConfigService) {}

  async complete(prompt: string, opts?: CompleteOptions): Promise<CompleteResult> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured on the server');
    }
    const baseModel = this.config.get<string>('GEMINI_MODEL') || 'gemini-2.5-pro';
    const model = opts?.escalate ? this.config.get<string>('GEMINI_ESCALATION_MODEL') || baseModel : baseModel;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        // A header keeps the key out of URLs — query strings are far more
        // likely to end up in access logs, proxies, or error messages.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            // Only when the caller actually wants structured output
            // (completeStructured) — forcing this for completeText's
            // free-form callers would wrap plain prose in an unwanted shape.
            ...(opts?.jsonMode ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      },
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${text}`);
    }

    const data = await response.json();
    const text =
      data.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('\n') ?? '';

    return {
      text,
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
    };
  }
}
