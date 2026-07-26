import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { LlmProviderName, TokenUsage } from '../common/types';
export interface StructuredResult<T> {
    result: T;
    usage: TokenUsage;
}
export declare class LlmService {
    private readonly config;
    private readonly providers;
    constructor(config: ConfigService, anthropic: AnthropicProvider, openai: OpenAiProvider, gemini: GeminiProvider);
    resolveProvider(requested?: string): LlmProviderName;
    hasEscalationModel(providerName: LlmProviderName): boolean;
    completeText(providerName: LlmProviderName, prompt: string): Promise<string>;
    completeStructured<T>(providerName: LlmProviderName, prompt: string, schema: z.ZodType<T>, opts?: {
        escalate?: boolean;
    }): Promise<StructuredResult<T>>;
}
