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
    getUsage(user: RequestUser): Promise<{
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
