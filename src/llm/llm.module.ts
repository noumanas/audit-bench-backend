import { Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { GeminiProvider } from './providers/gemini.provider';

@Module({
  providers: [LlmService, AnthropicProvider, OpenAiProvider, GeminiProvider],
  exports: [LlmService],
})
export class LlmModule {}
