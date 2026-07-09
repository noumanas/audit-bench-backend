import type { Finding } from '../common/finding.schema';

/** Points deducted per finding, by severity — same scale used across all three category scores. */
const SEVERITY_WEIGHT: Record<Finding['severity'], number> = {
  critical: 30,
  high: 15,
  medium: 6,
  low: 2,
};

const NPM_AUDIT_WEIGHT: Record<string, number> = {
  critical: 30,
  high: 15,
  moderate: 6,
  low: 2,
};

export function clampScore(raw: number): number {
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/** 100 minus severity-weighted deductions for findings matching the given categories. */
export function scoreForCategories(findings: Finding[], categories: Finding['category'][]): number {
  const deduction = findings
    .filter((f) => categories.includes(f.category))
    .reduce((sum, f) => sum + (SEVERITY_WEIGHT[f.severity] ?? 6), 0);
  return clampScore(100 - deduction);
}

/** Extra security deduction for a scan's secret-scan hits and vulnerable dependencies. */
export function extraSecurityDeduction(secretsCount: number, vulnSeverities: string[]): number {
  const secretsDeduction = secretsCount * 20;
  const vulnDeduction = vulnSeverities.reduce((sum, s) => sum + (NPM_AUDIT_WEIGHT[s] ?? 6), 0);
  return secretsDeduction + vulnDeduction;
}

/** Extra maintainability deduction for cross-file signals only visible at the repo level. */
export function extraDebtDeduction(deadCodeCount: number, duplicatesCount: number, circularImportsCount: number): number {
  return deadCodeCount * 3 + duplicatesCount * 4 + circularImportsCount * 8;
}
