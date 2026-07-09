import { LlmService } from '../llm/llm.service';
import { AuditCacheService, CachedAuditResult } from './cache.service';
import { LlmProviderName } from '../common/types';
import { LineRange } from '../common/diff-ranges';
export interface PipelineInput {
    filename: string;
    language?: string;
    code: string;
    provider: LlmProviderName;
    focusAreas?: string[];
    repoContext?: string;
    changedLineRanges?: LineRange[];
}
export interface PipelineOptions {
    beforeAiCall?: () => Promise<void>;
}
export interface PipelineOutput {
    result: CachedAuditResult;
    fromCache: boolean;
}
export declare class PipelineService {
    private readonly llm;
    private readonly cache;
    private readonly logger;
    constructor(llm: LlmService, cache: AuditCacheService);
    run(input: PipelineInput, opts?: PipelineOptions): Promise<PipelineOutput>;
}
