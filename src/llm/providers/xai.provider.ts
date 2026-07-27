import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

@Injectable()
export class XaiProvider extends OpenAiCompatibleProvider {
  readonly name = 'xai';

  constructor(config: ConfigService) {
    super(config, {
      displayName: 'xAI (Grok)',
      envPrefix: 'XAI',
      baseUrl: 'https://api.x.ai/v1/chat/completions',
      defaultModel: 'grok-3-fast',
      defaultEscalationModel: 'grok-4-0709',
    });
  }
}
