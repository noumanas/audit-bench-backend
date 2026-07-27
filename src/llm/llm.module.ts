import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
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

@Module({
  providers: [
    LlmService,
    AnthropicProvider,
    OpenAiProvider,
    GeminiProvider,
    DeepSeekProvider,
    GlmProvider,
    QwenProvider,
    KimiProvider,
    XaiProvider,
    MistralProvider,
    MiniMaxProvider,
  ],
  exports: [LlmService],
})
export class LlmModule {}
