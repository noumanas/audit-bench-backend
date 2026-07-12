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
        organization: {
            name: string;
            id: string;
            slug: string;
        } | null;
        email: string;
        name: string | null;
        id: string;
        badgeToken: string | null;
        role: import(".prisma/client").$Enums.Role;
        githubUsername: string | null;
        createdAt: Date;
        orgRole: import(".prisma/client").$Enums.OrgRole | null;
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
            organization: {
                name: string;
                id: string;
                slug: string;
            } | null;
            email: string;
            name: string | null;
            id: string;
            badgeToken: string | null;
            role: import(".prisma/client").$Enums.Role;
            githubUsername: string | null;
            createdAt: Date;
            orgRole: import(".prisma/client").$Enums.OrgRole | null;
        };
        request?: undefined;
    } | {
        applied: false;
        request: {
            organization: {
                name: string;
                id: string;
            } | null;
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
            organizationId: string | null;
            userId: string;
            status: import(".prisma/client").$Enums.PlanRequestStatus;
            note: string | null;
            reviewedAt: Date | null;
            requestedPlanId: string;
            reviewedById: string | null;
        };
        user?: undefined;
    }>;
    listMyPlanRequests(userId: string): Promise<({
        organization: {
            name: string;
            id: string;
        } | null;
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
        organizationId: string | null;
        userId: string;
        status: import(".prisma/client").$Enums.PlanRequestStatus;
        note: string | null;
        reviewedAt: Date | null;
        requestedPlanId: string;
        reviewedById: string | null;
    })[]>;
    getBadgeToken(userId: string): Promise<string>;
    rotateBadgeToken(userId: string): Promise<string>;
}
