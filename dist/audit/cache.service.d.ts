import { PrismaService } from '../prisma/prisma.service';
import { AuditResult } from '../common/types';
import { LineRange } from '../common/diff-ranges';
import { Stage1Result } from './stage1/types';
export interface CachedAuditResult extends AuditResult {
    stage1: Stage1Result | null;
    aiInvoked: boolean;
}
export declare class AuditCacheService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    hashFor(content: string, provider: string, focusAreas?: string[], changedRanges?: LineRange[]): string;
    exists(contentHash: string): Promise<boolean>;
    lookup(contentHash: string): Promise<CachedAuditResult | null>;
    store(contentHash: string, result: CachedAuditResult): Promise<void>;
}
