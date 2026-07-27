import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';

@Injectable()
export class QwenProvider extends OpenAiCompatibleProvider {
  readonly name = 'qwen';

  constructor(config: ConfigService) {
    super(config, {
      displayName: 'Qwen (DashScope)',
      envPrefix: 'QWEN',
      // International endpoint. DashScope API keys are region-specific —
      // a China-region key will not work against this base URL.
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      defaultModel: 'qwen-plus',
      defaultEscalationModel: 'qwen-max',
    });
  }
}
