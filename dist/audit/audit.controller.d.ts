import { AuditService } from './audit.service';
import { CreateAuditDto } from './dto/create-audit.dto';
import { RequestUser } from '../auth/types';
export declare class AuditController {
    private readonly auditService;
    constructor(auditService: AuditService);
    create(user: RequestUser, dto: CreateAuditDto): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        provider: string;
        verdict: import(".prisma/client").$Enums.Verdict;
        summary: string;
        aiInvoked: boolean;
        language: string | null;
        findings: import("@prisma/client/runtime/library").JsonValue;
        stage1: import("@prisma/client/runtime/library").JsonValue | null;
        fromCache: boolean;
        filename: string;
        codeSize: number;
    }>;
    findRecent(user: RequestUser, limit?: string): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        provider: string;
        verdict: import(".prisma/client").$Enums.Verdict;
        summary: string;
        aiInvoked: boolean;
        language: string | null;
        findings: import("@prisma/client/runtime/library").JsonValue;
        stage1: import("@prisma/client/runtime/library").JsonValue | null;
        fromCache: boolean;
        filename: string;
        codeSize: number;
    }[]>;
    findOne(user: RequestUser, id: string): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        provider: string;
        verdict: import(".prisma/client").$Enums.Verdict;
        summary: string;
        aiInvoked: boolean;
        language: string | null;
        findings: import("@prisma/client/runtime/library").JsonValue;
        stage1: import("@prisma/client/runtime/library").JsonValue | null;
        fromCache: boolean;
        filename: string;
        codeSize: number;
    }>;
}
