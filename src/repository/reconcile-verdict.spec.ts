import { reconcileVerdict } from './reconcile-verdict';
import { aggregateRisk } from './risk-aggregation';

const job = (over: Record<string, unknown> = {}) => ({
  files: [],
  secrets: [],
  dependencyVulnerabilities: [],
  licenseFindings: [],
  circularImports: [],
  deadCode: [],
  duplicates: [],
  testCoverage: { riskLevel: 'low' },
  contributorStats: null,
  architectureAssessment: null,
  ...over,
});

describe('reconcileVerdict', () => {
  it('never passes a scan with exposed secrets', () => {
    const secrets = [
      { path: 'a.cs', line: 1, rule: 'r', snippet: 's', fingerprint: 'k1' },
      { path: 'b.cs', line: 1, rule: 'r', snippet: 's', fingerprint: 'k1' },
    ];
    const r = reconcileVerdict('pass', { uniqueSecrets: 1, risk: aggregateRisk(job({ secrets })) });
    expect(r.verdict).toBe('do_not_ship');
    expect(r.reasons[0]).toContain('1 exposed secret');
  });

  it('leaves a clean scan alone', () => {
    expect(reconcileVerdict('pass', { uniqueSecrets: 0, risk: aggregateRisk(job()) })).toEqual({
      verdict: 'pass',
      reasons: [],
    });
  });
});

describe('aggregateRisk secrets', () => {
  it('counts a key repeated across files once, and shows how the estimate was worked out', () => {
    const secrets = Array.from({ length: 23 }, (_, i) => ({ path: `f${i}.cs`, line: 1, rule: 'r', snippet: 's', fingerprint: i < 20 ? 'k1' : `k${i}` }));
    const r = aggregateRisk(job({ secrets }));
    const item = r.remediation.items.find((i) => i.category === 'Exposed secrets')!;
    expect(item.description).toContain('4 distinct credential');
    expect(item.basis).toContain('4 distinct secret(s) × 0.25 days');
    expect(r.remediation.rateBasis).toContain('$600–$1000');
  });
});
