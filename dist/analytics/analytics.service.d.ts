import { PrismaService } from '../prisma/prisma.service';
import type { AnalyticsOverview, AnalyticsTrend } from './analytics.types';
export declare class AnalyticsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    private loadResourceScores;
    private usageTotals;
    repos(userId: string): Promise<string[]>;
    overview(userId: string, windowDays: number, repoFilter?: string): Promise<AnalyticsOverview>;
    trend(userId: string, windowDays: number, repoFilter?: string): Promise<AnalyticsTrend>;
}
