import { ConfigService } from '@nestjs/config';
import { CompleteOptions, LlmProvider } from '../llm-provider.interface';
export declare class OpenAiProvider implements LlmProvider {
    private readonly config;
    readonly name = "openai";
    constructor(config: ConfigService);
    complete(prompt: string, opts?: CompleteOptions): Promise<string>;
    private request;
}
