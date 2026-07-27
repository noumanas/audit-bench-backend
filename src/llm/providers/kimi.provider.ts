import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

@Injectable()
export class KimiProvider extends OpenAiCompatibleProvider {
  readonly name = 'kimi';

  constructor(config: ConfigService) {
    super(config, {
      displayName: 'Kimi (Moonshot AI)',
      envPrefix: 'KIMI',
      baseUrl: 'https://api.moonshot.ai/v1/chat/completions',
      defaultModel: 'kimi-k2.5',
      defaultEscalationModel: 'kimi-k2.6',
    });
  }
}
