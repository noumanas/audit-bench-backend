import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

@Injectable()
export class DeepSeekProvider extends OpenAiCompatibleProvider {
  readonly name = 'deepseek';

  constructor(config: ConfigService) {
    super(config, {
      displayName: 'DeepSeek',
      envPrefix: 'DEEPSEEK',
      baseUrl: 'https://api.deepseek.com/v1/chat/completions',
      defaultModel: 'deepseek-v4-flash',
      defaultEscalationModel: 'deepseek-v4-pro',
    });
  }
}
