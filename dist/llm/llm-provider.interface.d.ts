export interface CompleteOptions {
    escalate?: boolean;
}
export interface LlmProvider {
    readonly name: string;
    complete(prompt: string, opts?: CompleteOptions): Promise<string>;
}
