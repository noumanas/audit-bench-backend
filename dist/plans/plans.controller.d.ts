import { PlansService } from './plans.service';
export declare class PlansController {
    private readonly plansService;
    constructor(plansService: PlansService);
    findAll(): Promise<{
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
    }[]>;
}
