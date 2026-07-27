import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { GlmProvider } from './providers/glm.provider';
import { QwenProvider } from './providers/qwen.provider';
import { KimiProvider } from './providers/kimi.provider';
import { XaiProvider } from './providers/xai.provider';
import { MistralProvider } from './providers/mistral.provider';
import { MiniMaxProvider } from './providers/minimax.provider';
import { LlmProviderName, TokenUsage } from '../common/types';
export interface StructuredResult<T> {
    result: T;
    usage: TokenUsage;
}
export declare class LlmService {
    private readonly config;
    private readonly providers;
    constructor(config: ConfigService, anthropic: AnthropicProvider, openai: OpenAiProvider, gemini: GeminiProvider, deepseek: DeepSeekProvider, glm: GlmProvider, qwen: QwenProvider, kimi: KimiProvider, xai: XaiProvider, mistral: MistralProvider, minimax: MiniMaxProvider);
    resolveProvider(requested?: string): LlmProviderName;
    hasEscalationModel(providerName: LlmProviderName): boolean;
    completeText(providerName: LlmProviderName, prompt: string): Promise<string>;
    completeStructured<T>(providerName: LlmProviderName, prompt: string, schema: z.ZodType<T>, opts?: {
        escalate?: boolean;
    }): Promise<StructuredResult<T>>;
}
