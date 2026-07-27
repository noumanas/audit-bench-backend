import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

@Injectable()
export class GlmProvider extends OpenAiCompatibleProvider {
  readonly name = 'glm';

  constructor(config: ConfigService) {
    super(config, {
      displayName: 'Z.AI (GLM)',
      envPrefix: 'GLM',
      baseUrl: 'https://api.z.ai/api/openai/v1/chat/completions',
      defaultModel: 'glm-4.5-flash',
      defaultEscalationModel: 'glm-5.2',
    });
  }
}
