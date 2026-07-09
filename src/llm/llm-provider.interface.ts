export interface CompleteOptions {
  /**
   * Use the provider's configured escalation model instead of its default
   * one — for findings worth a second, more expensive pass. Providers fall
   * back to the default model if no escalation model is configured.
   */
  escalate?: boolean;
}

export interface LlmProvider {
  readonly name: string;
  complete(prompt: string, opts?: CompleteOptions): Promise<string>;
}
