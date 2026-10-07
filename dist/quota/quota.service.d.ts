import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
type Db = Prisma.TransactionClient;
export declare class QuotaService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    private loadUserWithPlan;
    private effectivePlan;
    private scopeOf;
    private countAiRepoScans;
    private countUsage;
    getUsage(userId: string, db?: Db): Promise<{
        plan: {
            id: string;
            name: string;
            createdAt: Date;
            slug: string;
            priceMonthlyCents: number;
            dailyAuditLimit: number | null;
            monthlyAuditLimit: number | null;
            repositoryScan: boolean;
            maxRepositories: number | null;
            alignmentLabEnabled: boolean;
            monthlyInvestigationLimit: number | null;
            monthlyRepoScanLimit: number | null;
            dueDiligence: boolean;
        };
        scope: "organization" | "personal";
        organizationName: string | null;
        dailyUsed: number;
        dailyLimit: number | null;
        monthlyUsed: number;
        monthlyLimit: number | null;
        repoScansUsed: number;
        repoScanLimit: number | null;
        dueDiligence: boolean;
        planExpiresAt: Date | null;
        dailyResetsAt: Date;
        monthlyResetsAt: Date;
    }>;
    assertCanRunAudit(userId: string, db?: Db): Promise<void>;
    assertPlanAllowsRepositoryScan(userId: string, db?: Db): Promise<void>;
    assertCanScanNewRepository(userId: string, repoKey: string, db?: Db): Promise<void>;
    assertCanRunAiRepoScan(userId: string, db?: Db): Promise<void>;
    canUseDueDiligence(userId: string, role: 'user' | 'admin' | 'super_admin', db?: Db): Promise<boolean>;
    assertCanRunInvestigation(userId: string, role: 'user' | 'admin' | 'super_admin', db?: Db): Promise<void>;
    withQuotaCheck<T>(checker: (db: Db) => Promise<void>, create: (db: Db) => Promise<T>, attempt?: number): Promise<T>;
}
export {};
