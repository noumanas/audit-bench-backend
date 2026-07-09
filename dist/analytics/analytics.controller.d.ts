import { AnalyticsService } from './analytics.service';
import { RequestUser } from '../auth/types';
export declare class AnalyticsController {
    private readonly analyticsService;
    constructor(analyticsService: AnalyticsService);
    overview(user: RequestUser, days?: string): Promise<import("./analytics.types").AnalyticsOverview>;
    trend(user: RequestUser, days?: string): Promise<import("./analytics.types").AnalyticsTrend>;
}
