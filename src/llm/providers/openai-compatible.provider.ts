import { ConfigService } from '@nestjs/config';
import { CompleteOptions, CompleteResult, LlmProvider } from '../llm-provider.interface';

const DEFAULT_MAX_OUTPUT_TOKENS = 4000;

export interface OpenAiCompatibleSettings {
  /** Human-readable name for error messages, e.g. "DeepSeek". */
  displayName: string;
  /**
   * Env var prefix — drives `${KEY}_API_KEY`, `${KEY}_MODEL`, and
   * `${KEY}_ESCALATION_MODEL`, matching the convention every other provider
   * already follows (see LlmService.hasEscalationModel).
   */
  envPrefix: string;
  /** Full chat-completions URL, e.g. 'https://api.deepseek.com/v1/chat/completions'. */
  baseUrl: string;
  defaultModel: string;
  defaultEscalationModel?: string;
  maxOutputTokens?: number;
}

/**
 * Shared implementation for the many providers that expose an
 * OpenAI-compatible /chat/completions endpoint (DeepSeek, GLM, Qwen, Kimi,
 * xAI, Mistral, MiniMax). Deliberately omits OpenAI-only extras like
 * `response_format`/`reasoning_effort` — support for those isn't guaranteed
 * across every compatible provider, and the prompts already instruct the
 * model to return raw JSON, same as the Anthropic/Gemini providers do.
 */
export abstract class OpenAiCompatibleProvider implements LlmProvider {
  abstract readonly name: string;

  constructor(
    protected readonly config: ConfigService,
    private readonly settings: OpenAiCompatibleSettings,
  ) {}

  async complete(prompt: string, opts?: CompleteOptions): Promise<CompleteResult> {
    const apiKeyVar = `${this.settings.envPrefix}_API_KEY`;
    const apiKey = this.config.get<string>(apiKeyVar);
    if (!apiKey) {
      throw new Error(`${apiKeyVar} is not configured on the server`);
    }

    const baseModel = this.config.get<string>(`${this.settings.envPrefix}_MODEL`) || this.settings.defaultModel;
    const model = opts?.escalate
      ? this.config.get<string>(`${this.settings.envPrefix}_ESCALATION_MODEL`) ||
        this.settings.defaultEscalationModel ||
        baseModel
      : baseModel;

    const response = await fetch(this.settings.baseUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: this.settings.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${this.settings.displayName} API error (${response.status}): ${text}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    if (choice?.finish_reason === 'length') {
      throw new Error(
        `${this.settings.displayName} response was truncated before completing (hit the output token limit)`,
      );
    }

    return {
      text: choice?.message?.content ?? '',
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}
