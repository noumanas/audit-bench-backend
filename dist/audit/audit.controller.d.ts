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
        aiInvoked: boolean;
        fromCache: boolean;
        verdict: import(".prisma/client").$Enums.Verdict;
        summary: string;
        findings: import("@prisma/client/runtime/library").JsonValue;
        stage1: import("@prisma/client/runtime/library").JsonValue | null;
        filename: string;
        provider: string;
        language: string | null;
        codeSize: number;
    }>;
    findRecent(user: RequestUser, limit?: string): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        aiInvoked: boolean;
        fromCache: boolean;
        verdict: import(".prisma/client").$Enums.Verdict;
        summary: string;
        findings: import("@prisma/client/runtime/library").JsonValue;
        stage1: import("@prisma/client/runtime/library").JsonValue | null;
        filename: string;
        provider: string;
        language: string | null;
        codeSize: number;
    }[]>;
    findOne(user: RequestUser, id: string): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        aiInvoked: boolean;
        fromCache: boolean;
        verdict: import(".prisma/client").$Enums.Verdict;
        summary: string;
        findings: import("@prisma/client/runtime/library").JsonValue;
        stage1: import("@prisma/client/runtime/library").JsonValue | null;
        filename: string;
        provider: string;
        language: string | null;
        codeSize: number;
    }>;
}
