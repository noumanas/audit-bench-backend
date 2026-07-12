import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceActor } from '../common/workspace-scope';
import type { AnalyticsOverview, AnalyticsTrend } from './analytics.types';
export declare class AnalyticsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    private loadResourceScores;
    private usageTotals;
    repos(actor: WorkspaceActor): Promise<string[]>;
    overview(actor: WorkspaceActor, windowDays: number, repoFilter?: string): Promise<AnalyticsOverview>;
    trend(actor: WorkspaceActor, windowDays: number, repoFilter?: string): Promise<AnalyticsTrend>;
}
