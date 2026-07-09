import { PrismaService } from '../prisma/prisma.service';
export declare class UsersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getProfile(userId: string): Promise<{
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
        email: string;
        name: string | null;
        id: string;
        githubUsername: string | null;
        createdAt: Date;
    }>;
    changePlan(userId: string, slug: string): Promise<{
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
        email: string;
        name: string | null;
        id: string;
        githubUsername: string | null;
        createdAt: Date;
    }>;
}
