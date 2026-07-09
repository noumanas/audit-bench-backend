import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Finding } from '../common/finding.schema';
import { clampScore, scoreForCategories, extraSecurityDeduction, extraDebtDeduction } from './scoring';
import type {
  AnalyticsOverview,
  AnalyticsTrend,
  RiskiestItem,
  TopIssue,
  TrendPoint,
} from './analytics.types';

interface ResourceScore {
  createdAt: Date;
  label: string;
  kind: 'audit' | 'scan';
  verdict: string | null;
  findings: Finding[];
  security: number;
  performance: number;
  technicalDebt: number;
  criticalCount: number;
  highCount: number;
}

const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 };

function average(values: number[]): number {
  if (values.length === 0) return 100;
  return clampScore(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function startOfDayUtc(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadResourceScores(userId: string, since: Date): Promise<ResourceScore[]> {
    const [audits, scanJobs] = await Promise.all([
      this.prisma.audit.findMany({
        where: { userId, createdAt: { gte: since } },
        select: { filename: true, verdict: true, findings: true, createdAt: true },
      }),
      this.prisma.scanJob.findMany({
        where: { userId, createdAt: { gte: since }, status: 'completed' },
        select: {
          sourceName: true,
          verdict: true,
          createdAt: true,
          secrets: true,
          dependencyVulnerabilities: true,
          deadCode: true,
          duplicates: true,
          circularImports: true,
          files: { select: { findings: true } },
        },
      }),
    ]);

    const auditScores: ResourceScore[] = audits.map((a) => {
      const findings = ((a.findings as unknown as Finding[]) ?? []).filter(Boolean);
      return {
        createdAt: a.createdAt,
        label: a.filename,
        kind: 'audit',
        verdict: a.verdict,
        findings,
        security: scoreForCategories(findings, ['Security']),
        performance: scoreForCategories(findings, ['Performance']),
        technicalDebt: scoreForCategories(findings, ['Maintainability', 'Architecture']),
        criticalCount: findings.filter((f) => f.severity === 'critical').length,
        highCount: findings.filter((f) => f.severity === 'high').length,
      };
    });

    const scanScores: ResourceScore[] = scanJobs.map((s) => {
      const findings = s.files.flatMap((f) => ((f.findings as unknown as Finding[]) ?? []).filter(Boolean));
      const secretsCount = Array.isArray(s.secrets) ? s.secrets.length : 0;
      const vulns = Array.isArray(s.dependencyVulnerabilities)
        ? (s.dependencyVulnerabilities as Array<{ severity?: string }>)
        : [];
      const deadCodeCount = Array.isArray(s.deadCode) ? s.deadCode.length : 0;
      const duplicatesCount = Array.isArray(s.duplicates) ? s.duplicates.length : 0;
      const circularCount = Array.isArray(s.circularImports) ? s.circularImports.length : 0;

      const security = clampScore(
        scoreForCategories(findings, ['Security']) -
          extraSecurityDeduction(secretsCount, vulns.map((v) => v.severity ?? 'unknown')),
      );
      const technicalDebt = clampScore(
        scoreForCategories(findings, ['Maintainability', 'Architecture']) -
          extraDebtDeduction(deadCodeCount, duplicatesCount, circularCount),
      );

      return {
        createdAt: s.createdAt,
        label: s.sourceName,
        kind: 'scan',
        verdict: s.verdict,
        findings,
        security,
        performance: scoreForCategories(findings, ['Performance']),
        technicalDebt,
        criticalCount: findings.filter((f) => f.severity === 'critical').length,
        highCount: findings.filter((f) => f.severity === 'high').length,
      };
    });

    return [...auditScores, ...scanScores];
  }

  private async usageTotals(userId: string, since: Date) {
    const [
      auditFresh,
      auditCached,
      auditSkipped,
      scanFileFresh,
      scanFileCached,
      scanFileSkipped,
      auditCount,
      scanCount,
    ] = await Promise.all([
      this.prisma.audit.count({ where: { userId, createdAt: { gte: since }, aiInvoked: true, fromCache: false } }),
      this.prisma.audit.count({ where: { userId, createdAt: { gte: since }, fromCache: true } }),
      this.prisma.audit.count({ where: { userId, createdAt: { gte: since }, aiInvoked: false, fromCache: false } }),
      this.prisma.scanFile.count({
        where: { scanJob: { userId }, createdAt: { gte: since }, aiInvoked: true, fromCache: false },
      }),
      this.prisma.scanFile.count({ where: { scanJob: { userId }, createdAt: { gte: since }, fromCache: true } }),
      this.prisma.scanFile.count({
        where: { scanJob: { userId }, createdAt: { gte: since }, aiInvoked: false, fromCache: false },
      }),
      this.prisma.audit.count({ where: { userId, createdAt: { gte: since } } }),
      this.prisma.scanJob.count({ where: { userId, createdAt: { gte: since } } }),
    ]);

    const freshAiCalls = auditFresh + scanFileFresh;
    const cachedHits = auditCached + scanFileCached;
    const localOnlySkips = auditSkipped + scanFileSkipped;
    const totalRuns = freshAiCalls + cachedHits + localOnlySkips;

    return {
      audits: auditCount,
      scans: scanCount,
      freshAiCalls,
      cachedHits,
      localOnlySkips,
      cacheSavingsPct: totalRuns ? clampScore(((cachedHits + localOnlySkips) / totalRuns) * 100) : 0,
    };
  }

  async overview(userId: string, windowDays: number): Promise<AnalyticsOverview> {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const [resources, totals] = await Promise.all([
      this.loadResourceScores(userId, since),
      this.usageTotals(userId, since),
    ]);

    const verdictBreakdown = { pass: 0, needs_work: 0, do_not_ship: 0 };
    for (const r of resources) {
      if (r.verdict && r.verdict in verdictBreakdown) {
        verdictBreakdown[r.verdict as keyof typeof verdictBreakdown]++;
      }
    }

    const scores = {
      security: average(resources.map((r) => r.security)),
      performance: average(resources.map((r) => r.performance)),
      technicalDebt: average(resources.map((r) => r.technicalDebt)),
    };

    const riskiest: RiskiestItem[] = [...resources]
      .sort((a, b) => b.criticalCount * 2 + b.highCount - (a.criticalCount * 2 + a.highCount))
      .slice(0, 5)
      .filter((r) => r.criticalCount > 0 || r.highCount > 0)
      .map((r) => ({
        label: r.label,
        kind: r.kind,
        verdict: r.verdict,
        createdAt: r.createdAt.toISOString(),
        criticalCount: r.criticalCount,
        highCount: r.highCount,
      }));

    const grouped = new Map<string, TopIssue>();
    for (const r of resources) {
      for (const f of r.findings) {
        const key = `${f.category}::${f.title.trim().toLowerCase()}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.count++;
          if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[existing.maxSeverity]) existing.maxSeverity = f.severity;
        } else {
          grouped.set(key, { category: f.category, title: f.title, count: 1, maxSeverity: f.severity });
        }
      }
    }
    const topIssues = [...grouped.values()]
      .sort((a, b) => b.count - a.count || SEVERITY_RANK[b.maxSeverity] - SEVERITY_RANK[a.maxSeverity])
      .slice(0, 6);

    return { windowDays, totals, verdictBreakdown, scores, riskiest, topIssues };
  }

  async trend(userId: string, windowDays: number): Promise<AnalyticsTrend> {
    const since = new Date(Date.now() - (windowDays - 1) * 24 * 60 * 60 * 1000);
    const sinceStart = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
    const resources = await this.loadResourceScores(userId, sinceStart);

    const buckets = new Map<string, ResourceScore[]>();
    for (let i = 0; i < windowDays; i++) {
      buckets.set(startOfDayUtc(new Date(sinceStart.getTime() + i * 24 * 60 * 60 * 1000)), []);
    }
    for (const r of resources) {
      const key = startOfDayUtc(r.createdAt);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(r);
    }

    const points: TrendPoint[] = [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rs]) => ({
        date,
        audits: rs.filter((r) => r.kind === 'audit').length,
        scans: rs.filter((r) => r.kind === 'scan').length,
        security: rs.length ? average(rs.map((r) => r.security)) : null,
        performance: rs.length ? average(rs.map((r) => r.performance)) : null,
        technicalDebt: rs.length ? average(rs.map((r) => r.technicalDebt)) : null,
      }));

    return { windowDays, points };
  }
}
