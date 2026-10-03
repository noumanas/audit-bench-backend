import { aggregateRisk } from './risk-aggregation';
import { assessTdd, TddInput, TDD_AREAS, TDD_DOMAINS, TDD_CHECK_CATALOG_SIZE } from './tdd-assessment';

function job(overrides: Partial<TddInput> = {}): TddInput {
  return {
    files: [],
    secrets: [],
    dependencyVulnerabilities: [],
    licenseFindings: [],
    circularImports: [],
    deadCode: [],
    duplicates: [],
    testCoverage: null,
    contributorStats: null,
    architectureAssessment: null,
    dependencyGraph: null,
    createdAt: '2026-08-25T00:00:00.000Z',
    ...overrides,
  };
}

const stage1 = (extra: Record<string, unknown> = {}) => ({
  lint: [],
  python: [],
  tsDiagnostics: [],
  semgrep: { skipped: true, reason: 'not installed' },
  functions: [],
  riskyFunctions: [],
  clean: true,
  ...extra,
});

function run(input: TddInput) {
  return assessTdd(input, aggregateRisk(input));
}

const check = (a: ReturnType<typeof run>, id: string) => a.checks.find((c) => c.id === id)!;

describe('assessTdd', () => {
  it('maps 15 domains onto 6 areas and every check onto a known domain', () => {
    expect(TDD_AREAS).toHaveLength(6);
    expect(TDD_DOMAINS).toHaveLength(15);
    const a = run(job());
    expect(a.checks).toHaveLength(TDD_CHECK_CATALOG_SIZE);
    for (const c of a.checks) expect(TDD_DOMAINS.some((d) => d.id === c.domainId)).toBe(true);
    for (const d of TDD_DOMAINS) expect(a.checks.some((c) => c.domainId === d.id)).toBe(true);
  });

  it('never counts a check without data as passed', () => {
    const a = run(job({ secrets: null, dependencyVulnerabilities: null, licenseFindings: null, circularImports: null, deadCode: null, duplicates: null }));
    expect(a.coverage.checksRun).toBe(0);
    expect(a.coverage.checksPassed).toBe(0);
    expect(a.coverage.notAssessed).toBe(TDD_CHECK_CATALOG_SIZE);
    expect(a.areas.every((x) => x.rating === 'not_assessed')).toBe(true);
  });

  it('keeps AI-dependent checks unassessed when no file got AI review', () => {
    const a = run(job({ files: [{ path: 'a.py', language: 'Python', findings: [], stage1: stage1(), aiInvoked: false, fromCache: false }] }));
    expect(check(a, 'appsec.auth').status).toBe('not_assessed');
    expect(check(a, 'performance.findings').status).toBe('not_assessed');
    expect(check(a, 'appsec.critical').status).toBe('pass');
    expect(check(a, 'appsec.deserialization').status).toBe('pass');
    expect(check(a, 'correctness.compile').status).toBe('not_assessed'); // no TypeScript
  });

  it('fails secret checks with path/line evidence but never the secret itself', () => {
    const a = run(job({ secrets: [{ path: 'keys/sa.json', line: 5, rule: 'Private Key', snippet: '-----BEGIN PRIVATE KEY-----abc' }] }));
    const c = check(a, 'secrets.private_keys');
    expect(c.status).toBe('fail');
    expect(c.severity).toBe('critical');
    expect(c.evidence).toEqual([{ path: 'keys/sa.json', line: 5, note: 'Private key material' }]);
    expect(JSON.stringify(a)).not.toContain('BEGIN PRIVATE KEY');
    expect(a.areas.find((x) => x.id === 'security')!.rating).toBe('critical');
  });

  it('flags committed .env files only as a failure, never as a pass', () => {
    const clean = run(job());
    expect(check(clean, 'config.env_files').status).toBe('not_assessed');
    const dirty = run(job({ duplicates: [{ linesOfCode: 8, occurrences: [{ path: '.env', startLine: 1, endLine: 8 }, { path: '.env.dev', startLine: 1, endLine: 8 }] }] }));
    expect(check(dirty, 'config.env_files').status).toBe('fail');
    expect(check(dirty, 'config.env_files').evidence.map((e) => e.path)).toEqual(['.env', '.env.dev']);
  });

  it('detects a departed primary author from commit dates', () => {
    const a = run(
      job({
        contributorStats: [
          { author: 'lead', commits: 300, lastCommitAt: '2026-05-01T00:00:00.000Z' },
          { author: 'other', commits: 100, lastCommitAt: '2026-08-20T00:00:00.000Z' },
        ],
      }),
    );
    expect(check(a, 'concentration.top_share').status).toBe('fail');
    expect(check(a, 'continuity.top_active').status).toBe('fail');
    expect(check(a, 'continuity.recent_activity').status).toBe('pass');
    expect(check(a, 'continuity.active_team').status).toBe('fail');
  });

  it('treats graph-derived checks as unassessed when no import graph was built', () => {
    expect(check(run(job()), 'modularity.circular').status).toBe('not_assessed');
    expect(check(run(job()), 'duplication.dead_code').status).toBe('not_assessed');
    const withGraph = run(job({ dependencyGraph: { graph: { 'a.ts': ['b.ts'], 'b.ts': ['a.ts'] } }, circularImports: [['a.ts', 'b.ts', 'a.ts']] }));
    expect(check(withGraph, 'modularity.circular').status).toBe('fail');
    expect(check(withGraph, 'modularity.circular').evidence[0].note).toBe('a.ts → b.ts → a.ts');
    expect(check(withGraph, 'duplication.dead_code').status).toBe('pass');
  });

  it('builds the remediation plan from aggregateRisk so totals always agree', () => {
    const input = job({
      secrets: [{ path: 'a', line: 1, rule: 'GitHub Token', snippet: '' }],
      dependencyVulnerabilities: [{ package: 'x', severity: 'high', title: 't', url: '', range: '' }],
      testCoverage: { testFileRatio: 0.01, testFileCount: 1, sourceFileCount: 100, hasCoverageConfig: false, hasCiTestStep: false, riskLevel: 'high', untestedDirectories: ['src'] },
    });
    const risk = aggregateRisk(input);
    const a = assessTdd(input, risk);
    const planDays = a.remediationPlan.steps.reduce((s, x) => s + x.estimatedDays, 0);
    expect(Math.round(planDays * 100) / 100).toBe(risk.remediation.totalEstimatedDays);
    expect(a.remediationPlan.steps.reduce((s, x) => s + x.costLowUsd, 0)).toBe(risk.remediation.estimatedCostLowUsd);
    expect(a.remediationPlan.steps[0].phase).toBe('pre_close');
    expect(a.remediationPlan.byPhase.days_90.days).toBe(15);
  });
});
