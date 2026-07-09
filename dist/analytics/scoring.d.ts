import type { Finding } from '../common/finding.schema';
export declare function clampScore(raw: number): number;
export declare function scoreForCategories(findings: Finding[], categories: Finding['category'][]): number;
export declare function extraSecurityDeduction(secretsCount: number, vulnSeverities: string[]): number;
export declare function extraDebtDeduction(deadCodeCount: number, duplicatesCount: number, circularImportsCount: number): number;
