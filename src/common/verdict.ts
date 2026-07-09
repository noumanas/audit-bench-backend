import { Finding, Verdict } from './types';

const RANK: Record<Verdict, number> = { pass: 0, needs_work: 1, do_not_ship: 2 };

export function worstVerdict(verdicts: Verdict[]): Verdict {
  return verdicts.reduce((worst, v) => (RANK[v] > RANK[worst] ? v : worst), 'pass' as Verdict);
}

export function verdictForSeverities(findings: Pick<Finding, 'severity'>[]): Verdict {
  if (findings.some((f) => f.severity === 'critical')) return 'do_not_ship';
  if (findings.some((f) => f.severity === 'high' || f.severity === 'medium')) return 'needs_work';
  return 'pass';
}
