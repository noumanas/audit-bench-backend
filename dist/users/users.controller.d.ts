import { RequestUser } from '../auth/types';
import { UsersService } from './users.service';
import { QuotaService } from '../quota/quota.service';
import { ChangePlanDto } from './dto/change-plan.dto';
export declare class UsersController {
    private readonly usersService;
    private readonly quotaService;
    constructor(usersService: UsersService, quotaService: QuotaService);
    getProfile(user: RequestUser): Promise<{
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
    getUsage(user: RequestUser): Promise<{
        plan: {
            dailyAuditLimit: number | null;
            monthlyAuditLimit: number | null;
            repositoryScan: boolean;
            name: string;
        };
        scope: "organization" | "personal";
        organizationName: string | null;
        dailyUsed: number;
        dailyLimit: number | null;
        monthlyUsed: number;
        monthlyLimit: number | null;
        dailyResetsAt: Date;
        monthlyResetsAt: Date;
    }>;
    changePlan(user: RequestUser, dto: ChangePlanDto): Promise<{
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
    listMyPlanRequests(user: RequestUser): Promise<({
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
    getBadgeToken(user: RequestUser): Promise<{
        badgeToken: string;
    }>;
    rotateBadgeToken(user: RequestUser): Promise<{
        badgeToken: string;
    }>;
}
