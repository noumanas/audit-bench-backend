import { PrismaService } from '../prisma/prisma.service';
export declare class PlansService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    findAll(): Promise<{
        name: string;
        id: string;
        createdAt: Date;
        slug: string;
        priceMonthlyCents: number;
        dailyAuditLimit: number | null;
        monthlyAuditLimit: number | null;
        repositoryScan: boolean;
    }[]>;
}
