import { TokenUsage } from '../common/types';

export interface CompleteOptions {
  /**
   * Use the provider's configured escalation model instead of its default
   * one — for findings worth a second, more expensive pass. Providers fall
   * back to the default model if no escalation model is configured.
   */
  escalate?: boolean;
  /**
   * Set only by LlmService.completeStructured — lets a provider opt into its
   * own native JSON-mode enforcement (e.g. OpenAI's response_format,
   * Gemini's responseMimeType) when the caller actually wants structured
   * output. Must stay unset for completeText: OpenAI's API rejects
   * response_format unless the prompt itself contains the word "json", and
   * a free-text caller (e.g. the alignment-lab investigator's target
   * persona, or the PR-chat reply) has no reason to promise that.
   */
  jsonMode?: boolean;
}

export interface CompleteResult {
  text: string;
  usage: TokenUsage;
}

export interface LlmProvider {
  readonly name: string;
  complete(prompt: string, opts?: CompleteOptions): Promise<CompleteResult>;
}
