export interface ScoreSet {
    security: number;
    performance: number;
    technicalDebt: number;
}
export interface VerdictBreakdown {
    pass: number;
    needs_work: number;
    do_not_ship: number;
}
export interface UsageTotals {
    audits: number;
    scans: number;
    freshAiCalls: number;
    cachedHits: number;
    localOnlySkips: number;
    cacheSavingsPct: number;
}
export interface RiskiestItem {
    resourceId: string;
    label: string;
    kind: 'audit' | 'scan';
    verdict: string | null;
    createdAt: string;
    criticalCount: number;
    highCount: number;
}
export interface TopIssue {
    category: string;
    title: string;
    count: number;
    maxSeverity: string;
}
export interface SeverityBreakdown {
    critical: number;
    high: number;
    medium: number;
    low: number;
}
export type CategoryBreakdown = Partial<Record<string, number>>;
export interface CriticalIssue {
    title: string;
    category: string;
    severity: string;
    confidencePct: number;
    resourceId: string;
    resourceLabel: string;
    resourceKind: 'audit' | 'scan';
}
export interface AnalyticsOverview {
    windowDays: number;
    repoFilter: string | null;
    totals: UsageTotals;
    activeRepositories: number;
    prReviewCount: number;
    verdictBreakdown: VerdictBreakdown;
    scores: ScoreSet;
    riskiest: RiskiestItem[];
    topIssues: TopIssue[];
    severityBreakdown: SeverityBreakdown;
    categoryBreakdown: CategoryBreakdown;
    patchesAvailable: number;
    totalFindings: number;
    criticalIssues: CriticalIssue[];
}
export interface TrendPoint {
    date: string;
    audits: number;
    scans: number;
    security: number | null;
    performance: number | null;
    technicalDebt: number | null;
}
export interface AnalyticsTrend {
    windowDays: number;
    points: TrendPoint[];
}
