import { ConfigService } from '@nestjs/config';
import { CompleteOptions, LlmProvider } from '../llm-provider.interface';
export declare class AnthropicProvider implements LlmProvider {
    private readonly config;
    readonly name = "anthropic";
    constructor(config: ConfigService);
    complete(prompt: string, opts?: CompleteOptions): Promise<string>;
}
