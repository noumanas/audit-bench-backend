import { ConfigService } from '@nestjs/config';
import { CompleteOptions, LlmProvider } from '../llm-provider.interface';
export declare class GeminiProvider implements LlmProvider {
    private readonly config;
    readonly name = "gemini";
    constructor(config: ConfigService);
    complete(prompt: string, opts?: CompleteOptions): Promise<string>;
}
