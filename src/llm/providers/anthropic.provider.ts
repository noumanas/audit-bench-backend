import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompleteOptions, LlmProvider } from '../llm-provider.interface';

const MAX_OUTPUT_TOKENS = 2000;

@Injectable()
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';

  constructor(private readonly config: ConfigService) {}

  async complete(prompt: string, opts?: CompleteOptions): Promise<string> {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not configured on the server');
    }

    const baseModel = this.config.get<string>('ANTHROPIC_MODEL') || 'claude-sonnet-4-5';
    const model = opts?.escalate ? this.config.get<string>('ANTHROPIC_ESCALATION_MODEL') || baseModel : baseModel;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${text}`);
    }

    const data = await response.json();
    return (data.content || [])
      .map((block: { type: string; text?: string }) => (block.type === 'text' ? block.text : ''))
      .filter(Boolean)
      .join('\n');
  }
}
