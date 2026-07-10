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
        role: import(".prisma/client").$Enums.Role;
        githubUsername: string | null;
        createdAt: Date;
    }>;
    changePlan(userId: string, slug: string): Promise<{
        applied: true;
        user: {
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
            role: import(".prisma/client").$Enums.Role;
            githubUsername: string | null;
            createdAt: Date;
        };
        request?: undefined;
    } | {
        applied: false;
        request: {
            requestedPlan: {
                name: string;
                id: string;
                createdAt: Date;
                slug: string;
                priceMonthlyCents: number;
                dailyAuditLimit: number | null;
                monthlyAuditLimit: number | null;
                repositoryScan: boolean;
            };
            reviewedBy: {
                email: string;
                name: string | null;
                id: string;
            } | null;
        } & {
            id: string;
            createdAt: Date;
            status: import(".prisma/client").$Enums.PlanRequestStatus;
            note: string | null;
            reviewedAt: Date | null;
            userId: string;
            requestedPlanId: string;
            reviewedById: string | null;
        };
        user?: undefined;
    }>;
    listMyPlanRequests(userId: string): Promise<({
        requestedPlan: {
            name: string;
            id: string;
            createdAt: Date;
            slug: string;
            priceMonthlyCents: number;
            dailyAuditLimit: number | null;
            monthlyAuditLimit: number | null;
            repositoryScan: boolean;
        };
        reviewedBy: {
            email: string;
            name: string | null;
            id: string;
        } | null;
    } & {
        id: string;
        createdAt: Date;
        status: import(".prisma/client").$Enums.PlanRequestStatus;
        note: string | null;
        reviewedAt: Date | null;
        userId: string;
        requestedPlanId: string;
        reviewedById: string | null;
    })[]>;
}
