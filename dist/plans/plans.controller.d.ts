import { PlansService } from './plans.service';
export declare class PlansController {
    private readonly plansService;
    constructor(plansService: PlansService);
    findAll(): Promise<{
        name: string;
        id: string;
        createdAt: Date;
        slug: string;
        priceMonthlyCents: number;
        dailyAuditLimit: number | null;
        monthlyAuditLimit: number | null;
        repositoryScan: boolean;
    }[]>;
}
