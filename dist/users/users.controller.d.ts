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
        email: string;
        name: string | null;
        id: string;
        githubUsername: string | null;
        createdAt: Date;
    }>;
    getUsage(user: RequestUser): Promise<{
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
        dailyUsed: number;
        dailyLimit: number | null;
        monthlyUsed: number;
        monthlyLimit: number | null;
        dailyResetsAt: Date;
        monthlyResetsAt: Date;
    }>;
    changePlan(user: RequestUser, dto: ChangePlanDto): Promise<{
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
