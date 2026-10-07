import { RequestUser } from '../auth/types';
import { UsersService } from './users.service';
import { QuotaService } from '../quota/quota.service';
import { ChangePlanDto } from './dto/change-plan.dto';
export declare class UsersController {
    private readonly usersService;
    private readonly quotaService;
    constructor(usersService: UsersService, quotaService: QuotaService);
    getProfile(user: RequestUser): Promise<{
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
    getUsage(user: RequestUser): Promise<{
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
    changePlan(user: RequestUser, dto: ChangePlanDto): Promise<{
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
    listMyPlanRequests(user: RequestUser): Promise<({
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
    getBadgeToken(user: RequestUser): Promise<{
        badgeToken: string;
    }>;
    rotateBadgeToken(user: RequestUser): Promise<{
        badgeToken: string;
    }>;
    getApiKey(user: RequestUser): Promise<{
        apiKey: string;
    }>;
    rotateApiKey(user: RequestUser): Promise<{
        apiKey: string;
    }>;
}
