import { PrismaService } from '../prisma/prisma.service';
import type { AnalyticsOverview, AnalyticsTrend } from './analytics.types';
export declare class AnalyticsService {
    private readonly prisma;
    constructor(prisma: PrismaService);
    private loadResourceScores;
    private usageTotals;
    overview(userId: string, windowDays: number): Promise<AnalyticsOverview>;
    trend(userId: string, windowDays: number): Promise<AnalyticsTrend>;
}
