import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

@Injectable()
export class MiniMaxProvider extends OpenAiCompatibleProvider {
  readonly name = 'minimax';

  constructor(config: ConfigService) {
    super(config, {
      displayName: 'MiniMax',
      envPrefix: 'MINIMAX',
      baseUrl: 'https://api.minimax.io/v1/chat/completions',
      defaultModel: 'MiniMax-M2.5',
      defaultEscalationModel: 'MiniMax-M3',
    });
  }
}
