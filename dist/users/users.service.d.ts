import { PrismaService } from '../prisma/prisma.service';
export declare class UsersService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    getProfile(userId: string): Promise<{
        id: string;
        email: string;
        badgeToken: string | null;
        name: string | null;
        role: import(".prisma/client").$Enums.Role;
        githubUsername: string | null;
        createdAt: Date;
        plan: {
            id: string;
            name: string;
            createdAt: Date;
            slug: string;
            priceMonthlyCents: number;
            dailyAuditLimit: number | null;
            monthlyAuditLimit: number | null;
            repositoryScan: boolean;
        };
    }>;
    changePlan(userId: string, slug: string): Promise<{
        applied: true;
        user: {
            id: string;
            email: string;
            badgeToken: string | null;
            name: string | null;
            role: import(".prisma/client").$Enums.Role;
            githubUsername: string | null;
            createdAt: Date;
            plan: {
                id: string;
                name: string;
                createdAt: Date;
                slug: string;
                priceMonthlyCents: number;
                dailyAuditLimit: number | null;
                monthlyAuditLimit: number | null;
                repositoryScan: boolean;
            };
        };
        request?: undefined;
    } | {
        applied: false;
        request: {
            requestedPlan: {
                id: string;
                name: string;
                createdAt: Date;
                slug: string;
                priceMonthlyCents: number;
                dailyAuditLimit: number | null;
                monthlyAuditLimit: number | null;
                repositoryScan: boolean;
            };
            reviewedBy: {
                id: string;
                email: string;
                name: string | null;
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
            id: string;
            name: string;
            createdAt: Date;
            slug: string;
            priceMonthlyCents: number;
            dailyAuditLimit: number | null;
            monthlyAuditLimit: number | null;
            repositoryScan: boolean;
        };
        reviewedBy: {
            id: string;
            email: string;
            name: string | null;
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
    getBadgeToken(userId: string): Promise<string>;
    rotateBadgeToken(userId: string): Promise<string>;
}
