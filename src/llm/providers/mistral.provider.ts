import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

@Injectable()
export class MistralProvider extends OpenAiCompatibleProvider {
  readonly name = 'mistral';

  constructor(config: ConfigService) {
    super(config, {
      displayName: 'Mistral',
      envPrefix: 'MISTRAL',
      baseUrl: 'https://api.mistral.ai/v1/chat/completions',
      // "-latest" aliases are maintained by Mistral to always point at their
      // current model for that tier, so these stay accurate without upkeep.
      defaultModel: 'mistral-small-latest',
      defaultEscalationModel: 'mistral-large-latest',
    });
  }
}
