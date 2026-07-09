import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
type Db = Prisma.TransactionClient;
export declare class QuotaService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    private loadUserWithPlan;
    private countUsage;
    getUsage(userId: string, db?: Db): Promise<{
        plan: {
            name: string;
            id: string;
            createdAt: Date;
            slug: string;
            priceMonthlyCents: number;
            dailyAuditLimit: number | null;
            monthlyAuditLimit: number | null;
            repositoryScan: boolean;
        };
        dailyUsed: number;
        dailyLimit: number | null;
        monthlyUsed: number;
        monthlyLimit: number | null;
        dailyResetsAt: Date;
        monthlyResetsAt: Date;
    }>;
    assertCanRunAudit(userId: string, db?: Db): Promise<void>;
    assertPlanAllowsRepositoryScan(userId: string, db?: Db): Promise<void>;
    assertCanScanRepository(userId: string, db?: Db): Promise<void>;
    withQuotaCheck<T>(checker: (db: Db) => Promise<void>, create: (db: Db) => Promise<T>, attempt?: number): Promise<T>;
}
export {};
