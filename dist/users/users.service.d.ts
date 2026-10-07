import { SubscriptionService } from '../revenue/subscription.service';
import { PrismaService } from '../prisma/prisma.service';
export declare class UsersService {
    private readonly prisma;
    private readonly subscriptions;
    constructor(prisma: PrismaService, subscriptions: SubscriptionService);
    getProfile(userId: string): Promise<{
        id: string;
        createdAt: Date;
        name: string | null;
        plan: {
            id: string;
            createdAt: Date;
            slug: string;
            name: string;
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
        email: string;
        role: import(".prisma/client").$Enums.Role;
        githubUsername: string | null;
        badgeToken: string | null;
        orgRole: import(".prisma/client").$Enums.OrgRole | null;
        organization: {
            id: string;
            slug: string;
            name: string;
        } | null;
    }>;
    changePlan(userId: string, slug: string): Promise<{
        applied: true;
        user: {
            id: string;
            createdAt: Date;
            name: string | null;
            plan: {
                id: string;
                createdAt: Date;
                slug: string;
                name: string;
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
            email: string;
            role: import(".prisma/client").$Enums.Role;
            githubUsername: string | null;
            badgeToken: string | null;
            orgRole: import(".prisma/client").$Enums.OrgRole | null;
            organization: {
                id: string;
                slug: string;
                name: string;
            } | null;
        };
        request?: undefined;
    } | {
        applied: false;
        request: {
            organization: {
                id: string;
                name: string;
            } | null;
            requestedPlan: {
                id: string;
                createdAt: Date;
                slug: string;
                name: string;
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
            reviewedBy: {
                id: string;
                name: string | null;
                email: string;
            } | null;
        } & {
            status: import(".prisma/client").$Enums.PlanRequestStatus;
            id: string;
            createdAt: Date;
            userId: string;
            organizationId: string | null;
            note: string | null;
            reviewedAt: Date | null;
            requestedPlanId: string;
            reviewedById: string | null;
        };
        user?: undefined;
    }>;
    listMyPlanRequests(userId: string): Promise<({
        organization: {
            id: string;
            name: string;
        } | null;
        requestedPlan: {
            id: string;
            createdAt: Date;
            slug: string;
            name: string;
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
        reviewedBy: {
            id: string;
            name: string | null;
            email: string;
        } | null;
    } & {
        status: import(".prisma/client").$Enums.PlanRequestStatus;
        id: string;
        createdAt: Date;
        userId: string;
        organizationId: string | null;
        note: string | null;
        reviewedAt: Date | null;
        requestedPlanId: string;
        reviewedById: string | null;
    })[]>;
    getBadgeToken(userId: string): Promise<string>;
    rotateBadgeToken(userId: string): Promise<string>;
    getApiKey(userId: string): Promise<string>;
    rotateApiKey(userId: string): Promise<string>;
}
