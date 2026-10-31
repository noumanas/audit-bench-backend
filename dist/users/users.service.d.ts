import { SubscriptionService } from '../revenue/subscription.service';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
export declare class UsersService {
    private readonly prisma;
    private readonly subscriptions;
    private readonly email;
    private readonly config;
    private readonly logger;
    constructor(prisma: PrismaService, subscriptions: SubscriptionService, email: EmailService, config: ConfigService);
    private notifyPlanRequest;
    getProfile(userId: string): Promise<{
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
        organization: {
            id: string;
            name: string;
            slug: string;
        } | null;
        id: string;
        email: string;
        badgeToken: string | null;
        name: string | null;
        role: import(".prisma/client").$Enums.Role;
        githubUsername: string | null;
        createdAt: Date;
        orgRole: import(".prisma/client").$Enums.OrgRole | null;
    }>;
    changePlan(userId: string, slug: string): Promise<{
        applied: true;
        user: {
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
            organization: {
                id: string;
                name: string;
                slug: string;
            } | null;
            id: string;
            email: string;
            badgeToken: string | null;
            name: string | null;
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
                id: string;
                name: string;
            } | null;
            requestedPlan: {
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
            reviewedBy: {
                id: string;
                email: string;
                name: string | null;
            } | null;
        } & {
            id: string;
            createdAt: Date;
            organizationId: string | null;
            userId: string;
            status: import(".prisma/client").$Enums.PlanRequestStatus;
            reviewedById: string | null;
            note: string | null;
            reviewedAt: Date | null;
            requestedPlanId: string;
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
        reviewedBy: {
            id: string;
            email: string;
            name: string | null;
        } | null;
    } & {
        id: string;
        createdAt: Date;
        organizationId: string | null;
        userId: string;
        status: import(".prisma/client").$Enums.PlanRequestStatus;
        reviewedById: string | null;
        note: string | null;
        reviewedAt: Date | null;
        requestedPlanId: string;
    })[]>;
    getBadgeToken(userId: string): Promise<string>;
    rotateBadgeToken(userId: string): Promise<string>;
    getApiKey(userId: string): Promise<string>;
    rotateApiKey(userId: string): Promise<string>;
    deleteAccount(userId: string, confirmEmail: string): Promise<{
        deleted: boolean;
    }>;
}
