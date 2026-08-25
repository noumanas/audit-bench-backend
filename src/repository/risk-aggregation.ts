export type RiskLevel = 'high' | 'medium' | 'low';

export interface RiskCategoryScore {
  category: string;
  riskLevel: RiskLevel | null; // null = not enough data to assess this category
  detail: string;
}

export interface RemediationItem {
  category: string;
  description: string;
  estimatedDays: number;
}

export interface RiskAggregation {
  overallRiskRating: RiskLevel;
  /** 0-100, higher = healthier — same "higher is better" convention as ArchitectureAssessment.consistencyScore. */
  overallHealthScore: number;
  categories: RiskCategoryScore[];
  remediation: {
    items: RemediationItem[];
    totalEstimatedDays: number;
    estimatedCostLowUsd: number;
    estimatedCostHighUsd: number;
  };
  /** Qualitative follow-ups that aren't naturally an engineer-day estimate (e.g. talent retention, legal review). */
  recommendations: string[];
  summary: string;
}

/** Loosely-typed on purpose — matches what Prisma returns for a Json? column (unknown), and keeps this module Prisma-independent and easy to unit test with plain objects. */
export interface ScanJobRiskInput {
  files: Array<{ findings: unknown }>;
  secrets: unknown;
  dependencyVulnerabilities: unknown;
  licenseFindings: unknown;
  circularImports: unknown;
  deadCode: unknown;
  duplicates: unknown;
  testCoverage: unknown;
  contributorStats: unknown;
  architectureAssessment: unknown;
}

// Blended engineer-day rate used to turn a day estimate into a dollar range
// — deliberately a range, not a single number, since a point estimate would
// overclaim precision a static heuristic can't back up.
const DAY_RATE_LOW_USD = 600;
const DAY_RATE_HIGH_USD = 1000;

// PRD's own framing: "Critical findings weighted highest, talent
// concentration and test coverage weighted moderately." Security carries
// the most weight; license/architecture the least (real, but rarely
// deal-breaking on their own).
const CATEGORY_WEIGHTS: Record<string, number> = {
  Security: 3,
  'Dependency risk': 2,
  'License compliance': 1.5,
  'Technical debt': 2,
  'Talent concentration': 2,
  'Architecture consistency': 1.5,
};

const RISK_NUMERIC: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3 };

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function severityCounts(items: Array<{ severity?: unknown }>): Record<'critical' | 'high' | 'medium' | 'low', number> {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const item of items) {
    const raw = typeof item?.severity === 'string' ? item.severity.toLowerCase() : '';
    const key = raw === 'moderate' ? 'medium' : raw; // npm audit uses "moderate"; normalize to this app's 4-level scale
    if (key === 'critical' || key === 'high' || key === 'medium' || key === 'low') counts[key]++;
  }
  return counts;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function scoreSecurity(input: ScanJobRiskInput): RiskCategoryScore {
  const allFindings = input.files.flatMap((f) => asArray(f.findings));
  const counts = severityCounts(allFindings as Array<{ severity?: unknown }>);
  const secretsCount = asArray(input.secrets).length;

  let riskLevel: RiskLevel;
  if (counts.critical > 0 || secretsCount > 0 || counts.high >= 3) riskLevel = 'high';
  else if (counts.high > 0 || counts.medium >= 5) riskLevel = 'medium';
  else riskLevel = 'low';

  return {
    category: 'Security',
    riskLevel,
    detail: `${counts.critical} critical, ${counts.high} high, ${counts.medium} medium finding(s); ${secretsCount} potential secret(s).`,
  };
}

function scoreDependencyRisk(input: ScanJobRiskInput): RiskCategoryScore {
  // A raw SQL null (the scan predates this check existing — see the
  // migration history) means "never assessed," not "confirmed clean" — an
  // empty array `[]` is the only thing that means the latter. Collapsing
  // both into "low" would overstate confidence on older scans.
  if (input.dependencyVulnerabilities == null) {
    return { category: 'Dependency risk', riskLevel: null, detail: 'No dependency scan available for this scan.' };
  }
  const vulns = asArray(input.dependencyVulnerabilities);
  if (vulns.length === 0) {
    return { category: 'Dependency risk', riskLevel: 'low', detail: 'No known-vulnerable dependencies detected.' };
  }
  const counts = severityCounts(vulns as Array<{ severity?: unknown }>);
  const riskLevel: RiskLevel = counts.critical > 0 || counts.high > 0 ? 'high' : counts.medium > 0 ? 'medium' : 'low';
  return {
    category: 'Dependency risk',
    riskLevel,
    detail: `${counts.critical} critical, ${counts.high} high, ${counts.medium} medium vulnerable dependency issue(s).`,
  };
}

function scoreLicenseCompliance(input: ScanJobRiskInput): RiskCategoryScore {
  // Same null-vs-empty-array distinction as scoreDependencyRisk above.
  if (input.licenseFindings == null) {
    return { category: 'License compliance', riskLevel: null, detail: 'No license compliance check available for this scan.' };
  }
  const findings = asArray(input.licenseFindings) as Array<{ riskLevel?: unknown }>;
  if (findings.length === 0) {
    return { category: 'License compliance', riskLevel: 'low', detail: 'No copyleft or unclear-license dependencies flagged.' };
  }
  const hasHigh = findings.some((f) => f.riskLevel === 'high');
  const hasMedium = findings.some((f) => f.riskLevel === 'medium');
  return {
    category: 'License compliance',
    riskLevel: hasHigh ? 'high' : hasMedium ? 'medium' : 'low',
    detail: `${findings.length} license compliance issue(s) flagged.`,
  };
}

function scoreTechnicalDebt(input: ScanJobRiskInput): RiskCategoryScore {
  const testCoverage = input.testCoverage as { riskLevel?: RiskLevel } | null;
  const circularCount = asArray(input.circularImports).length;
  const deadCodeCount = asArray(input.deadCode).length;
  const duplicatesCount = asArray(input.duplicates).length;

  if (!testCoverage?.riskLevel) {
    return {
      category: 'Technical debt',
      riskLevel: null,
      detail: 'No test-coverage estimate available to assess this category.',
    };
  }

  let riskLevel = testCoverage.riskLevel;
  const escalate = circularCount > 0 || deadCodeCount > 5 || duplicatesCount > 5;
  if (escalate && riskLevel === 'low') riskLevel = 'medium';
  else if (escalate && riskLevel === 'medium') riskLevel = 'high';

  return {
    category: 'Technical debt',
    riskLevel,
    detail: `Test-coverage risk ${testCoverage.riskLevel}; ${circularCount} circular import chain(s), ${deadCodeCount} possibly dead file(s), ${duplicatesCount} duplicate block(s).`,
  };
}

function scoreTalentConcentration(input: ScanJobRiskInput): RiskCategoryScore & { topContributor?: string; topShare?: number } {
  const stats = asArray(input.contributorStats) as Array<{ author?: string; commits?: number }>;
  const total = stats.reduce((sum, s) => sum + (typeof s.commits === 'number' ? s.commits : 0), 0);
  if (stats.length === 0 || total === 0) {
    return { category: 'Talent concentration', riskLevel: null, detail: 'No contributor data available to assess this category.' };
  }
  const top = stats.reduce((a, b) => ((a.commits ?? 0) >= (b.commits ?? 0) ? a : b));
  const topShare = (top.commits ?? 0) / total;
  const riskLevel: RiskLevel = topShare >= 0.5 ? 'high' : topShare >= 0.3 ? 'medium' : 'low';
  return {
    category: 'Talent concentration',
    riskLevel,
    detail: `${top.author ?? 'unknown'} authored ${Math.round(topShare * 100)}% of commits.`,
    topContributor: top.author,
    topShare,
  };
}

function scoreArchitecture(input: ScanJobRiskInput): RiskCategoryScore {
  const assessment = input.architectureAssessment as { riskLevel?: RiskLevel; consistencyScore?: number } | null;
  if (!assessment?.riskLevel) {
    return {
      category: 'Architecture consistency',
      riskLevel: null,
      detail: 'No architecture assessment available — only computed when the scan already needed a fresh AI review.',
    };
  }
  return {
    category: 'Architecture consistency',
    riskLevel: assessment.riskLevel,
    detail: `Consistency score ${assessment.consistencyScore ?? '—'}/100.`,
  };
}

/**
 * Deterministic, no-LLM aggregation over everything the scan already
 * computed — every category score, the overall rating, and the
 * remediation-cost estimate are plain arithmetic over existing findings, the
 * same way the scan's own summary text is template-composed rather than
 * LLM-written. Nothing here makes a new API call, so this is free and
 * instant to (re)compute on every read — no need to persist or invalidate it.
 */
export function aggregateRisk(input: ScanJobRiskInput): RiskAggregation {
  const security = scoreSecurity(input);
  const dependencyRisk = scoreDependencyRisk(input);
  const licenseCompliance = scoreLicenseCompliance(input);
  const technicalDebt = scoreTechnicalDebt(input);
  const talentConcentration = scoreTalentConcentration(input);
  const architecture = scoreArchitecture(input);

  const categories: RiskCategoryScore[] = [security, dependencyRisk, licenseCompliance, technicalDebt, talentConcentration, architecture];

  const assessed = categories.filter((c): c is RiskCategoryScore & { riskLevel: RiskLevel } => c.riskLevel !== null);
  let overallRiskRating: RiskLevel = 'low';
  let overallHealthScore = 100;
  if (assessed.length > 0) {
    const totalWeight = assessed.reduce((sum, c) => sum + (CATEGORY_WEIGHTS[c.category] ?? 1), 0);
    const weightedSum = assessed.reduce((sum, c) => sum + (CATEGORY_WEIGHTS[c.category] ?? 1) * RISK_NUMERIC[c.riskLevel], 0);
    const avgRisk = weightedSum / totalWeight; // 1 (low) .. 3 (high)
    overallRiskRating = avgRisk <= 1.5 ? 'low' : avgRisk <= 2.25 ? 'medium' : 'high';
    overallHealthScore = clamp(Math.round(((3 - avgRisk) / 2) * 100), 0, 100);
  }

  // Same override this codebase already applies to a single audit's verdict
  // (see common/verdict.ts: any critical finding forces "do_not_ship",
  // never just averaged in) — a critical security finding or an exposed
  // secret should never be diluted into a "medium" overall read just
  // because other categories came back clean.
  if (security.riskLevel === 'high') {
    overallRiskRating = 'high';
    overallHealthScore = Math.min(overallHealthScore, 39);
  }

  const remediation = estimateRemediation(input, security, dependencyRisk, licenseCompliance, technicalDebt, architecture);
  const recommendations = buildRecommendations(input, security, licenseCompliance, talentConcentration);

  const topDriver = [...assessed].sort((a, b) => RISK_NUMERIC[b.riskLevel] - RISK_NUMERIC[a.riskLevel])[0];
  const summary =
    assessed.length === 0
      ? 'Not enough data was gathered on this scan to compute a risk rating.'
      : `Overall risk: ${overallRiskRating.toUpperCase()} (health score ${overallHealthScore}/100)` +
        (topDriver && topDriver.riskLevel !== 'low' ? `, driven primarily by ${topDriver.category.toLowerCase()}` : '') +
        `. Estimated remediation: ${remediation.totalEstimatedDays} engineer-day(s) ($${remediation.estimatedCostLowUsd.toLocaleString()}–$${remediation.estimatedCostHighUsd.toLocaleString()}).`;

  return { overallRiskRating, overallHealthScore, categories, remediation, recommendations, summary };
}

function estimateRemediation(
  input: ScanJobRiskInput,
  security: RiskCategoryScore,
  dependencyRisk: RiskCategoryScore,
  licenseCompliance: RiskCategoryScore,
  technicalDebt: RiskCategoryScore,
  architecture: RiskCategoryScore,
): RiskAggregation['remediation'] {
  const items: RemediationItem[] = [];

  const allFindings = input.files.flatMap((f) => asArray(f.findings)) as Array<{ severity?: unknown }>;
  const secCounts = severityCounts(allFindings);
  const secretsCount = asArray(input.secrets).length;
  if (security.riskLevel && (secCounts.critical || secCounts.high || secCounts.medium)) {
    items.push({
      category: 'Security findings',
      description: `${secCounts.critical} critical, ${secCounts.high} high, ${secCounts.medium} medium finding(s) to fix.`,
      estimatedDays: clamp(secCounts.critical * 1.5 + secCounts.high * 0.75 + secCounts.medium * 0.25, 0, 90),
    });
  }
  if (secretsCount > 0) {
    items.push({
      category: 'Exposed secrets',
      description: `Rotate credentials and scrub ${secretsCount} potential secret(s) from history.`,
      estimatedDays: clamp(secretsCount * 0.1, 0.25, 5),
    });
  }

  const depCounts = severityCounts(asArray(input.dependencyVulnerabilities) as Array<{ severity?: unknown }>);
  if (dependencyRisk.riskLevel && (depCounts.critical || depCounts.high || depCounts.medium)) {
    items.push({
      category: 'Dependency vulnerabilities',
      description: `${depCounts.critical + depCounts.high} critical/high, ${depCounts.medium} medium vulnerable dependency version(s) to bump.`,
      estimatedDays: clamp((depCounts.critical + depCounts.high) * 0.25 + depCounts.medium * 0.1, 0, 30),
    });
  }

  const licenseFindings = asArray(input.licenseFindings) as Array<{ riskLevel?: RiskLevel }>;
  if (licenseFindings.length > 0) {
    const high = licenseFindings.filter((f) => f.riskLevel === 'high').length;
    const medium = licenseFindings.filter((f) => f.riskLevel === 'medium').length;
    const low = licenseFindings.length - high - medium;
    items.push({
      category: 'License compliance',
      description: `Replace or get legal sign-off on ${high} high-risk, ${medium} medium-risk dependency license(s).`,
      estimatedDays: clamp(high * 1 + medium * 0.5 + low * 0.1, 0, 20),
    });
  }

  const circularCount = asArray(input.circularImports).length;
  const deadCodeCount = asArray(input.deadCode).length;
  const duplicatesCount = asArray(input.duplicates).length;
  if (circularCount || deadCodeCount || duplicatesCount) {
    items.push({
      category: 'Structural debt',
      description: `Break ${circularCount} circular import chain(s), remove ${deadCodeCount} dead file(s), consolidate ${duplicatesCount} duplicate block(s).`,
      estimatedDays: clamp(circularCount * 0.5 + deadCodeCount * 0.1 + duplicatesCount * 0.3, 0, 20),
    });
  }

  const testCoverage = input.testCoverage as { riskLevel?: RiskLevel } | null;
  if (testCoverage?.riskLevel === 'high' || testCoverage?.riskLevel === 'medium') {
    items.push({
      category: 'Test coverage',
      description: `Bring untested modules up to a baseline coverage standard (test-coverage risk: ${testCoverage.riskLevel}).`,
      estimatedDays: testCoverage.riskLevel === 'high' ? 15 : 6,
    });
  }

  const inconsistencyCount = Array.isArray((input.architectureAssessment as any)?.inconsistencies)
    ? (input.architectureAssessment as any).inconsistencies.length
    : 0;
  if (architecture.riskLevel && inconsistencyCount > 0) {
    items.push({
      category: 'Architecture inconsistencies',
      description: `Reconcile ${inconsistencyCount} identified architectural inconsistency/inconsistencies.`,
      estimatedDays: clamp(inconsistencyCount * 2, 0, 20),
    });
  }

  const totalEstimatedDays = Math.round(items.reduce((sum, i) => sum + i.estimatedDays, 0) * 10) / 10;
  return {
    items,
    totalEstimatedDays,
    estimatedCostLowUsd: Math.round(totalEstimatedDays * DAY_RATE_LOW_USD),
    estimatedCostHighUsd: Math.round(totalEstimatedDays * DAY_RATE_HIGH_USD),
  };
}

function buildRecommendations(
  input: ScanJobRiskInput,
  security: RiskCategoryScore,
  licenseCompliance: RiskCategoryScore,
  talentConcentration: RiskCategoryScore & { topContributor?: string; topShare?: number },
): string[] {
  const recommendations: string[] = [];
  const secretsCount = asArray(input.secrets).length;

  if (secretsCount > 0) {
    recommendations.push(`Rotate exposed credentials immediately — do not wait for the full remediation pass (${secretsCount} potential secret(s) found).`);
  }
  if (talentConcentration.riskLevel === 'high' && talentConcentration.topContributor) {
    recommendations.push(
      `Structure a retention incentive or transition/knowledge-transfer period for ${talentConcentration.topContributor} — ${Math.round((talentConcentration.topShare ?? 0) * 100)}% of commits, effectively a bus factor of 1.`,
    );
  } else if (talentConcentration.riskLevel === 'medium' && talentConcentration.topContributor) {
    recommendations.push(`Document key knowledge held by ${talentConcentration.topContributor} before any transition — moderate commit concentration.`);
  }
  if (licenseCompliance.riskLevel === 'high') {
    recommendations.push('Get legal sign-off on flagged copyleft dependencies before distribution or close.');
  }
  if (security.riskLevel === 'high') {
    recommendations.push('Treat critical/high security findings as a condition of close, not a post-close cleanup item.');
  }

  return recommendations;
}
