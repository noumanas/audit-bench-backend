import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { QuotaService } from '../quota/quota.service';
import { PipelineService } from './pipeline.service';
import { CreateAuditDto } from './dto/create-audit.dto';
import { Prisma } from '@prisma/client';
export declare class AuditService {
    private readonly prisma;
    private readonly llm;
    private readonly quota;
    private readonly pipeline;
    constructor(prisma: PrismaService, llm: LlmService, quota: QuotaService, pipeline: PipelineService);
    runAudit(userId: string, dto: CreateAuditDto): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        provider: string;
        aiInvoked: boolean;
        fromCache: boolean;
        verdict: import(".prisma/client").$Enums.Verdict;
        summary: string;
        findings: Prisma.JsonValue;
        stage1: Prisma.JsonValue | null;
        filename: string;
        language: string | null;
        codeSize: number;
    }>;
    findOne(userId: string, id: string): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        provider: string;
        aiInvoked: boolean;
        fromCache: boolean;
        verdict: import(".prisma/client").$Enums.Verdict;
        summary: string;
        findings: Prisma.JsonValue;
        stage1: Prisma.JsonValue | null;
        filename: string;
        language: string | null;
        codeSize: number;
    }>;
    findRecent(userId: string, limit?: number): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        provider: string;
        aiInvoked: boolean;
        fromCache: boolean;
        verdict: import(".prisma/client").$Enums.Verdict;
        summary: string;
        findings: Prisma.JsonValue;
        stage1: Prisma.JsonValue | null;
        filename: string;
        language: string | null;
        codeSize: number;
    }[]>;
}
