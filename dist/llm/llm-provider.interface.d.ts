import { TokenUsage } from '../common/types';
export interface CompleteOptions {
    escalate?: boolean;
}
export interface CompleteResult {
    text: string;
    usage: TokenUsage;
}
export interface LlmProvider {
    readonly name: string;
    complete(prompt: string, opts?: CompleteOptions): Promise<CompleteResult>;
}
