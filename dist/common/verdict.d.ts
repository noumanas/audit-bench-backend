import { Finding, Verdict } from './types';
export declare function worstVerdict(verdicts: Verdict[]): Verdict;
export declare function verdictForSeverities(findings: Pick<Finding, 'severity'>[]): Verdict;
