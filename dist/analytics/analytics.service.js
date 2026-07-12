"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const scoring_1 = require("./scoring");
const workspace_scope_1 = require("../common/workspace-scope");
const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
const PR_REVIEW_SOURCE_TYPES = new Set(['github_pr', 'gitlab_mr']);
function average(values) {
    if (values.length === 0)
        return 100;
    return (0, scoring_1.clampScore)(values.reduce((sum, v) => sum + v, 0) / values.length);
}
function startOfDayUtc(d) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}
let AnalyticsService = class AnalyticsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async loadResourceScores(actor, since, repoFilter) {
        const scope = (0, workspace_scope_1.workspaceWhere)(actor);
        const [audits, scanJobs] = await Promise.all([
            repoFilter
                ? Promise.resolve([])
                : this.prisma.audit.findMany({
                    where: { ...scope, createdAt: { gte: since } },
                    select: { filename: true, verdict: true, findings: true, createdAt: true },
                }),
            this.prisma.scanJob.findMany({
                where: {
                    ...scope,
                    createdAt: { gte: since },
                    status: 'completed',
                    ...(repoFilter ? { sourceName: { contains: repoFilter, mode: 'insensitive' } } : {}),
                },
                select: {
                    sourceName: true,
                    sourceType: true,
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
        const auditScores = audits.map((a) => {
            const findings = (a.findings ?? []).filter(Boolean);
            return {
                createdAt: a.createdAt,
                label: a.filename,
                kind: 'audit',
                sourceType: null,
                verdict: a.verdict,
                findings,
                security: (0, scoring_1.scoreForCategories)(findings, ['Security']),
                performance: (0, scoring_1.scoreForCategories)(findings, ['Performance']),
                technicalDebt: (0, scoring_1.scoreForCategories)(findings, ['Maintainability', 'Architecture']),
                criticalCount: findings.filter((f) => f.severity === 'critical').length,
                highCount: findings.filter((f) => f.severity === 'high').length,
            };
        });
        const scanScores = scanJobs.map((s) => {
            const findings = s.files.flatMap((f) => (f.findings ?? []).filter(Boolean));
            const secretsCount = Array.isArray(s.secrets) ? s.secrets.length : 0;
            const vulns = Array.isArray(s.dependencyVulnerabilities)
                ? s.dependencyVulnerabilities
                : [];
            const deadCodeCount = Array.isArray(s.deadCode) ? s.deadCode.length : 0;
            const duplicatesCount = Array.isArray(s.duplicates) ? s.duplicates.length : 0;
            const circularCount = Array.isArray(s.circularImports) ? s.circularImports.length : 0;
            const security = (0, scoring_1.clampScore)((0, scoring_1.scoreForCategories)(findings, ['Security']) -
                (0, scoring_1.extraSecurityDeduction)(secretsCount, vulns.map((v) => v.severity ?? 'unknown')));
            const technicalDebt = (0, scoring_1.clampScore)((0, scoring_1.scoreForCategories)(findings, ['Maintainability', 'Architecture']) -
                (0, scoring_1.extraDebtDeduction)(deadCodeCount, duplicatesCount, circularCount));
            return {
                createdAt: s.createdAt,
                label: s.sourceName,
                kind: 'scan',
                sourceType: s.sourceType,
                verdict: s.verdict,
                findings,
                security,
                performance: (0, scoring_1.scoreForCategories)(findings, ['Performance']),
                technicalDebt,
                criticalCount: findings.filter((f) => f.severity === 'critical').length,
                highCount: findings.filter((f) => f.severity === 'high').length,
            };
        });
        return [...auditScores, ...scanScores];
    }
    async usageTotals(actor, since) {
        const scope = (0, workspace_scope_1.workspaceWhere)(actor);
        const [auditFresh, auditCached, auditSkipped, scanFileFresh, scanFileCached, scanFileSkipped, auditCount, scanCount,] = await Promise.all([
            this.prisma.audit.count({ where: { ...scope, createdAt: { gte: since }, aiInvoked: true, fromCache: false } }),
            this.prisma.audit.count({ where: { ...scope, createdAt: { gte: since }, fromCache: true } }),
            this.prisma.audit.count({ where: { ...scope, createdAt: { gte: since }, aiInvoked: false, fromCache: false } }),
            this.prisma.scanFile.count({
                where: { scanJob: scope, createdAt: { gte: since }, aiInvoked: true, fromCache: false },
            }),
            this.prisma.scanFile.count({ where: { scanJob: scope, createdAt: { gte: since }, fromCache: true } }),
            this.prisma.scanFile.count({
                where: { scanJob: scope, createdAt: { gte: since }, aiInvoked: false, fromCache: false },
            }),
            this.prisma.audit.count({ where: { ...scope, createdAt: { gte: since } } }),
            this.prisma.scanJob.count({ where: { ...scope, createdAt: { gte: since } } }),
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
            cacheSavingsPct: totalRuns ? (0, scoring_1.clampScore)(((cachedHits + localOnlySkips) / totalRuns) * 100) : 0,
        };
    }
    async repos(actor) {
        const rows = await this.prisma.scanJob.findMany({
            where: (0, workspace_scope_1.workspaceWhere)(actor),
            distinct: ['sourceName'],
            select: { sourceName: true },
            orderBy: { createdAt: 'desc' },
            take: 50,
        });
        return rows.map((r) => r.sourceName);
    }
    async overview(actor, windowDays, repoFilter) {
        const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
        const [resources, totals] = await Promise.all([
            this.loadResourceScores(actor, since, repoFilter),
            this.usageTotals(actor, since),
        ]);
        const activeRepositories = new Set(resources.filter((r) => r.kind === 'scan').map((r) => r.label)).size;
        const prReviewCount = resources.filter((r) => r.sourceType && PR_REVIEW_SOURCE_TYPES.has(r.sourceType)).length;
        const verdictBreakdown = { pass: 0, needs_work: 0, do_not_ship: 0 };
        for (const r of resources) {
            if (r.verdict && r.verdict in verdictBreakdown) {
                verdictBreakdown[r.verdict]++;
            }
        }
        const scores = {
            security: average(resources.map((r) => r.security)),
            performance: average(resources.map((r) => r.performance)),
            technicalDebt: average(resources.map((r) => r.technicalDebt)),
        };
        const riskiest = [...resources]
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
        const grouped = new Map();
        for (const r of resources) {
            for (const f of r.findings) {
                const key = `${f.category}::${f.title.trim().toLowerCase()}`;
                const existing = grouped.get(key);
                if (existing) {
                    existing.count++;
                    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[existing.maxSeverity])
                        existing.maxSeverity = f.severity;
                }
                else {
                    grouped.set(key, { category: f.category, title: f.title, count: 1, maxSeverity: f.severity });
                }
            }
        }
        const topIssues = [...grouped.values()]
            .sort((a, b) => b.count - a.count || SEVERITY_RANK[b.maxSeverity] - SEVERITY_RANK[a.maxSeverity])
            .slice(0, 6);
        return {
            windowDays,
            repoFilter: repoFilter ?? null,
            totals,
            activeRepositories,
            prReviewCount,
            verdictBreakdown,
            scores,
            riskiest,
            topIssues,
        };
    }
    async trend(actor, windowDays, repoFilter) {
        const since = new Date(Date.now() - (windowDays - 1) * 24 * 60 * 60 * 1000);
        const sinceStart = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
        const resources = await this.loadResourceScores(actor, sinceStart, repoFilter);
        const buckets = new Map();
        for (let i = 0; i < windowDays; i++) {
            buckets.set(startOfDayUtc(new Date(sinceStart.getTime() + i * 24 * 60 * 60 * 1000)), []);
        }
        for (const r of resources) {
            const key = startOfDayUtc(r.createdAt);
            if (!buckets.has(key))
                buckets.set(key, []);
            buckets.get(key).push(r);
        }
        const points = [...buckets.entries()]
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
};
exports.AnalyticsService = AnalyticsService;
exports.AnalyticsService = AnalyticsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AnalyticsService);
//# sourceMappingURL=analytics.service.js.map