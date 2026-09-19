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

// Keyed by the six Finding categories (Security, Logic, Performance,
// Architecture, Maintainability, Testing) — a Partial since a window with no
// findings in a category simply omits that key rather than reporting a 0.
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
  // Distinct repos scanned in this window (repo scans + PR/MR reviews) —
  // single-file pasted audits aren't tied to a repo, so don't count here.
  activeRepositories: number;
  prReviewCount: number;
  verdictBreakdown: VerdictBreakdown;
  scores: ScoreSet;
  riskiest: RiskiestItem[];
  topIssues: TopIssue[];
  severityBreakdown: SeverityBreakdown;
  categoryBreakdown: CategoryBreakdown;
  // Findings that shipped a ready-to-apply examplePatch, out of all findings
  // in the window — a real count, not an estimate.
  patchesAvailable: number;
  totalFindings: number;
  // The single worst individual finding per category+title group, ranked by
  // severity then confidence — distinct from topIssues (which ranks by how
  // often an issue recurs); this ranks by how bad the worst instance is.
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
