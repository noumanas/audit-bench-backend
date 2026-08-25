import { aggregateRisk, ScanJobRiskInput } from './risk-aggregation';

function baseInput(overrides: Partial<ScanJobRiskInput> = {}): ScanJobRiskInput {
  return {
    files: [],
    secrets: [],
    dependencyVulnerabilities: [],
    licenseFindings: [],
    circularImports: [],
    deadCode: [],
    duplicates: [],
    testCoverage: null,
    contributorStats: [],
    architectureAssessment: null,
    ...overrides,
  };
}

describe('aggregateRisk', () => {
  it('reports low risk and a full health score when nothing is flagged anywhere', () => {
    const result = aggregateRisk(
      baseInput({
        testCoverage: { riskLevel: 'low' },
        contributorStats: [
          { author: 'a', commits: 4 },
          { author: 'b', commits: 4 },
          { author: 'c', commits: 4 },
          { author: 'd', commits: 4 },
          { author: 'e', commits: 4 },
        ],
        architectureAssessment: { riskLevel: 'low', consistencyScore: 95, inconsistencies: [] },
      }),
    );
    expect(result.overallRiskRating).toBe('low');
    expect(result.overallHealthScore).toBe(100);
    expect(result.remediation.totalEstimatedDays).toBe(0);
  });

  it('rates overall risk high when a critical security finding is present', () => {
    const result = aggregateRisk(
      baseInput({ files: [{ findings: [{ severity: 'critical' }] }] }),
    );
    const security = result.categories.find((c) => c.category === 'Security');
    expect(security?.riskLevel).toBe('high');
    expect(result.overallRiskRating).toBe('high');
    expect(result.overallHealthScore).toBeLessThan(50);
  });

  it('treats any exposed secret as high security risk even with no other findings', () => {
    const result = aggregateRisk(baseInput({ secrets: [{ rule: 'aws-key', path: 'a.ts', line: 1, snippet: 'x' }] }));
    const security = result.categories.find((c) => c.category === 'Security');
    expect(security?.riskLevel).toBe('high');
    expect(result.recommendations.some((r) => /rotate exposed credentials/i.test(r))).toBe(true);
  });

  it('marks a category as not-assessed (null) when there is no data for it', () => {
    const result = aggregateRisk(baseInput()); // testCoverage null, no contributor stats, no architecture assessment
    const debt = result.categories.find((c) => c.category === 'Technical debt');
    const talent = result.categories.find((c) => c.category === 'Talent concentration');
    const arch = result.categories.find((c) => c.category === 'Architecture consistency');
    expect(debt?.riskLevel).toBeNull();
    expect(talent?.riskLevel).toBeNull();
    expect(arch?.riskLevel).toBeNull();
  });

  it('overrides the overall rating to high on a critical security finding, even with clean dependency/license data', () => {
    // dependencyVulnerabilities/licenseFindings are genuinely confirmed
    // clean here (empty arrays are a real "low", not "not assessed"), so a
    // plain weighted average would dilute this toward "medium" — the
    // override below is what keeps a critical finding from being diluted.
    const result = aggregateRisk(baseInput({ files: [{ findings: [{ severity: 'critical' }] }] }));
    expect(result.overallRiskRating).toBe('high');
  });

  it('flags high talent concentration when one contributor dominates commits', () => {
    const result = aggregateRisk(
      baseInput({ contributorStats: [{ author: 'solo-dev', commits: 90 }, { author: 'other', commits: 10 }] }),
    );
    const talent = result.categories.find((c) => c.category === 'Talent concentration');
    expect(talent?.riskLevel).toBe('high');
    expect(result.recommendations.some((r) => r.includes('solo-dev'))).toBe(true);
  });

  it('escalates technical debt risk when structural debt signals are present alongside low test-coverage risk', () => {
    const result = aggregateRisk(
      baseInput({
        testCoverage: { riskLevel: 'low' },
        circularImports: [['a', 'b']],
      }),
    );
    const debt = result.categories.find((c) => c.category === 'Technical debt');
    expect(debt?.riskLevel).toBe('medium');
  });

  it('estimates non-zero remediation days and a wider cost range for more severe findings', () => {
    const result = aggregateRisk(
      baseInput({
        files: [{ findings: [{ severity: 'critical' }, { severity: 'high' }] }],
        dependencyVulnerabilities: [{ severity: 'critical' }],
      }),
    );
    expect(result.remediation.totalEstimatedDays).toBeGreaterThan(0);
    expect(result.remediation.estimatedCostHighUsd).toBeGreaterThan(result.remediation.estimatedCostLowUsd);
  });

  it('recommends legal review when a high-risk license finding is present', () => {
    const result = aggregateRisk(baseInput({ licenseFindings: [{ package: 'x', version: '1.0.0', license: 'GPL-3.0', riskLevel: 'high', reason: 'x' }] }));
    expect(result.recommendations.some((r) => /legal sign-off/i.test(r))).toBe(true);
  });

  it('treats a null dependencyVulnerabilities/licenseFindings as "not assessed", distinct from a confirmed-clean empty array', () => {
    // Real-world case: a scan run before these checks existed has these
    // columns as raw SQL null, not []. Collapsing that into "low" would
    // claim a dependency/license scan happened when it never did.
    const result = aggregateRisk(baseInput({ dependencyVulnerabilities: null as unknown as [], licenseFindings: null as unknown as [] }));
    const dependencyRisk = result.categories.find((c) => c.category === 'Dependency risk');
    const licenseCompliance = result.categories.find((c) => c.category === 'License compliance');
    expect(dependencyRisk?.riskLevel).toBeNull();
    expect(licenseCompliance?.riskLevel).toBeNull();
    expect(dependencyRisk?.detail).toMatch(/no dependency scan available/i);
    expect(licenseCompliance?.detail).toMatch(/no license compliance check available/i);
  });

  it('still reports a confident "low" for dependency/license risk when the check ran and found a genuinely empty array', () => {
    const result = aggregateRisk(baseInput({ dependencyVulnerabilities: [], licenseFindings: [] }));
    const dependencyRisk = result.categories.find((c) => c.category === 'Dependency risk');
    const licenseCompliance = result.categories.find((c) => c.category === 'License compliance');
    expect(dependencyRisk?.riskLevel).toBe('low');
    expect(licenseCompliance?.riskLevel).toBe('low');
  });

  it('reports low risk and zero remediation when there is no data at all', () => {
    // dependencyVulnerabilities/licenseFindings being empty arrays is a
    // real, confirmed "clean" result (unlike testCoverage/contributorStats/
    // architectureAssessment being null, which means "not assessed") — so
    // this is a genuinely fully-clean scan, not an "insufficient data" one.
    const result = aggregateRisk(baseInput());
    expect(result.overallRiskRating).toBe('low');
    expect(result.remediation.totalEstimatedDays).toBe(0);
    expect(result.summary).toMatch(/overall risk: low/i);
  });
});
