import { SubscriptionService } from '../revenue/subscription.service';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { isPlanExpired, planExpiryFor } from '../common/plan-expiry';

const REPO_SCAN_SOURCE_TYPES = ['zip', 'github_repo', 'gitlab_repo'] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Same "costs money" definition QuotaService counts against plan limits. */
const AI_AUDIT = { aiInvoked: true, fromCache: false } as const;
const AI_SCAN = { aiInvoked: true } as const;

type Key = 'userId' | 'organizationId';

interface Tally {
  aiAuditsToday: number;
  aiRunsToday: number;
  aiRunsMonth: number;
  aiRepoScansMonth: number;
  inputTokensMonth: number;
  outputTokensMonth: number;
}

const emptyTally = (): Tally => ({
  aiAuditsToday: 0,
  aiRunsToday: 0,
  aiRunsMonth: 0,
  aiRepoScansMonth: 0,
  inputTokensMonth: 0,
  outputTokensMonth: 0,
});

/**
 * Usage tracking for the admin panel. Everything here is read-only
 * aggregation over Audit/ScanJob rows, grouped in a handful of queries so
 * the users list stays one round trip no matter how many users there are.
 */
@Injectable()
export class AdminUsageService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  /** AI usage today / this month, keyed by userId or organizationId. */
  private async tallies(key: Key): Promise<Map<string, Tally>> {
    const day = startOfDay();
    const month = startOfMonth();
    // userId is never null; only the org grouping needs to skip personal rows.
    const notNull = key === 'organizationId' ? { organizationId: { not: null } } : {};
    const [auditsMonth, auditsToday, scansMonth, scansToday, repoScansMonth] = await Promise.all([
      this.prisma.audit.groupBy({
        by: [key],
        where: { ...notNull, ...AI_AUDIT, createdAt: { gte: month } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true },
      }),
      this.prisma.audit.groupBy({ by: [key], where: { ...notNull, ...AI_AUDIT, createdAt: { gte: day } }, _count: { _all: true } }),
      this.prisma.scanJob.groupBy({
        by: [key],
        where: { ...notNull, ...AI_SCAN, createdAt: { gte: month } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true },
      }),
      this.prisma.scanJob.groupBy({ by: [key], where: { ...notNull, ...AI_SCAN, createdAt: { gte: day } }, _count: { _all: true } }),
      this.prisma.scanJob.groupBy({
        by: [key],
        where: { ...notNull, ...AI_SCAN, createdAt: { gte: month }, sourceType: { in: [...REPO_SCAN_SOURCE_TYPES] } },
        _count: { _all: true },
      }),
    ]);

    const out = new Map<string, Tally>();
    const at = (id: string | null) => {
      if (!id) return null;
      if (!out.has(id)) out.set(id, emptyTally());
      return out.get(id)!;
    };
    const idOf = (row: Record<string, unknown>) => row[key] as string | null;
    for (const r of auditsMonth) {
      const t = at(idOf(r));
      if (!t) continue;
      t.aiRunsMonth += r._count._all;
      t.inputTokensMonth += r._sum.inputTokens ?? 0;
      t.outputTokensMonth += r._sum.outputTokens ?? 0;
    }
    for (const r of scansMonth) {
      const t = at(idOf(r));
      if (!t) continue;
      t.aiRunsMonth += r._count._all;
      t.inputTokensMonth += r._sum.inputTokens ?? 0;
      t.outputTokensMonth += r._sum.outputTokens ?? 0;
    }
    for (const r of auditsToday) {
      const t = at(idOf(r));
      if (t) {
        t.aiAuditsToday += r._count._all;
        t.aiRunsToday += r._count._all;
      }
    }
    for (const r of scansToday) {
      const t = at(idOf(r));
      if (t) t.aiRunsToday += r._count._all;
    }
    for (const r of repoScansMonth) {
      const t = at(idOf(r));
      if (t) t.aiRepoScansMonth += r._count._all;
    }
    return out;
  }

  private async lastActivity(): Promise<Map<string, Date>> {
    const [a, s] = await Promise.all([
      this.prisma.audit.groupBy({ by: ['userId'], _max: { createdAt: true } }),
      this.prisma.scanJob.groupBy({ by: ['userId'], _max: { createdAt: true } }),
    ]);
    const out = new Map<string, Date>();
    for (const r of [...a, ...s]) {
      const d = r._max.createdAt;
      if (d && (!out.has(r.userId) || out.get(r.userId)! < d)) out.set(r.userId, d);
    }
    return out;
  }

  async listUsersWithUsage() {
    const [users, freePlan, byUser, byOrg, lastActive] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          createdAt: true,
          lastLoginAt: true,
          plan: true,
          planExpiresAt: true,
          role: true,
          githubUsername: true,
          gitlabUsername: true,
          isActive: true,
          orgRole: true,
          organization: { select: { id: true, name: true, plan: true, planExpiresAt: true } },
          _count: { select: { audits: true, scanJobs: true } },
        },
      }),
      this.prisma.plan.findUnique({ where: { slug: 'free' } }),
      this.tallies('userId'),
      this.tallies('organizationId'),
      this.lastActivity(),
    ]);

    return users.map((u) => {
      const owner = u.organization ?? u;
      const expired = isPlanExpired(owner.planExpiresAt) && owner.plan.slug !== 'free';
      const plan = expired && freePlan ? freePlan : owner.plan;
      // Limits apply to the pool the user actually draws from — the org's
      // shared pool for team members (see QuotaService.getUsage).
      const pool = (u.organization ? byOrg.get(u.organization.id) : byUser.get(u.id)) ?? emptyTally();
      const own = byUser.get(u.id) ?? emptyTally();
      return {
        ...u,
        effectivePlan: plan,
        planExpired: expired,
        lastActiveAt: lastActive.get(u.id) ?? null,
        quota: {
          scope: u.organization ? ('organization' as const) : ('personal' as const),
          dailyUsed: pool.aiRunsToday,
          dailyLimit: plan.dailyAuditLimit,
          monthlyUsed: pool.aiRunsMonth,
          monthlyLimit: plan.monthlyAuditLimit,
          repoScansUsed: pool.aiRepoScansMonth,
          repoScanLimit: plan.monthlyRepoScanLimit,
        },
        // This user's own share, even inside a team pool.
        month: {
          aiRuns: own.aiRunsMonth,
          aiRepoScans: own.aiRepoScansMonth,
          inputTokens: own.inputTokensMonth,
          outputTokens: own.outputTokensMonth,
        },
      };
    });
  }

  async summary() {
    const month = startOfMonth();
    const since7 = new Date(Date.now() - 7 * DAY_MS);
    const since30 = new Date(Date.now() - 30 * DAY_MS);
    const [totalUsers, suspended, newThisMonth, a7, s7, a30, s30, aiAudits, aiScans] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { isActive: false } }),
      this.prisma.user.count({ where: { createdAt: { gte: month } } }),
      this.prisma.audit.findMany({ where: { createdAt: { gte: since7 } }, select: { userId: true }, distinct: ['userId'] }),
      this.prisma.scanJob.findMany({ where: { createdAt: { gte: since7 } }, select: { userId: true }, distinct: ['userId'] }),
      this.prisma.audit.findMany({ where: { createdAt: { gte: since30 } }, select: { userId: true }, distinct: ['userId'] }),
      this.prisma.scanJob.findMany({ where: { createdAt: { gte: since30 } }, select: { userId: true }, distinct: ['userId'] }),
      this.prisma.audit.aggregate({
        where: { ...AI_AUDIT, createdAt: { gte: month } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true },
      }),
      this.prisma.scanJob.aggregate({
        where: { ...AI_SCAN, createdAt: { gte: month } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true },
      }),
    ]);
    const distinct = (...lists: Array<Array<{ userId: string }>>) => new Set(lists.flat().map((r) => r.userId)).size;
    return {
      totalUsers,
      suspended,
      newThisMonth,
      activeUsers7d: distinct(a7, s7),
      activeUsers30d: distinct(a30, s30),
      aiRunsMonth: aiAudits._count._all + aiScans._count._all,
      inputTokensMonth: (aiAudits._sum.inputTokens ?? 0) + (aiScans._sum.inputTokens ?? 0),
      outputTokensMonth: (aiAudits._sum.outputTokens ?? 0) + (aiScans._sum.outputTokens ?? 0),
    };
  }

  /** One user's usage: quota meters, a 30-day daily series, totals and recent runs. */
  async userDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        lastLoginAt: true,
        planExpiresAt: true,
        role: true,
        isActive: true,
        githubUsername: true,
        gitlabUsername: true,
        orgRole: true,
        plan: true,
        organization: { select: { id: true, name: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const since = startOfDay(new Date(Date.now() - 29 * DAY_MS));
    const [quota, audits30, scans30, auditTotals, scanTotals, recentAudits, recentScans, planRequests] = await Promise.all([
      this.quota.getUsage(userId),
      this.prisma.audit.findMany({
        where: { userId, createdAt: { gte: since } },
        select: { createdAt: true, aiInvoked: true, fromCache: true, inputTokens: true, outputTokens: true },
      }),
      this.prisma.scanJob.findMany({
        where: { userId, createdAt: { gte: since } },
        select: { createdAt: true, aiInvoked: true, inputTokens: true, outputTokens: true },
      }),
      this.prisma.audit.aggregate({ where: { userId }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } }),
      this.prisma.scanJob.aggregate({ where: { userId }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true } }),
      this.prisma.audit.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, filename: true, verdict: true, provider: true, aiInvoked: true, fromCache: true, inputTokens: true, outputTokens: true, createdAt: true },
      }),
      this.prisma.scanJob.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: { id: true, sourceName: true, sourceType: true, status: true, verdict: true, provider: true, aiInvoked: true, inputTokens: true, outputTokens: true, createdAt: true },
      }),
      this.prisma.planRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, status: true, createdAt: true, reviewedAt: true, requestedPlan: { select: { name: true } } },
      }),
    ]);

    // Daily series, oldest first, one point per calendar day (local time).
    const days = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(since.getTime() + i * DAY_MS);
      return { date: d.toISOString().slice(0, 10), audits: 0, scans: 0, aiRuns: 0, tokens: 0 };
    });
    const bucket = (d: Date) => days[Math.min(29, Math.max(0, Math.floor((startOfDay(d).getTime() - since.getTime()) / DAY_MS)))];
    for (const a of audits30) {
      const b = bucket(a.createdAt);
      b.audits++;
      if (a.aiInvoked && !a.fromCache) b.aiRuns++;
      b.tokens += a.inputTokens + a.outputTokens;
    }
    for (const s of scans30) {
      const b = bucket(s.createdAt);
      b.scans++;
      if (s.aiInvoked) b.aiRuns++;
      b.tokens += s.inputTokens + s.outputTokens;
    }

    return {
      user,
      quota,
      daily: days,
      totals: {
        audits: auditTotals._count._all,
        scans: scanTotals._count._all,
        inputTokens: (auditTotals._sum.inputTokens ?? 0) + (scanTotals._sum.inputTokens ?? 0),
        outputTokens: (auditTotals._sum.outputTokens ?? 0) + (scanTotals._sum.outputTokens ?? 0),
      },
      recent: [
        ...recentAudits.map((a) => ({
          kind: 'audit' as const,
          id: a.id,
          label: a.filename && a.filename !== 'untitled' ? a.filename : 'Pasted code',
          verdict: a.verdict,
          status: 'completed' as const,
          provider: a.provider,
          usedAi: a.aiInvoked && !a.fromCache,
          tokens: a.inputTokens + a.outputTokens,
          createdAt: a.createdAt,
        })),
        ...recentScans.map((s) => ({
          kind: 'scan' as const,
          id: s.id,
          label: s.sourceName,
          verdict: s.verdict,
          status: s.status,
          provider: s.provider,
          usedAi: s.aiInvoked,
          tokens: s.inputTokens + s.outputTokens,
          createdAt: s.createdAt,
        })),
      ]
        .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())
        .slice(0, 10),
      planRequests,
    };
  }

  /**
   * Adds another 30-day term to a personal paid plan: from the current
   * expiry if it's still running (so renewing early never loses days),
   * otherwise from now.
   */
  async renewPlan(userId: string, actorId?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { plan: true } });
    if (!user) throw new NotFoundException('User not found');
    if (user.plan.slug === 'free') throw new BadRequestException('Free plans have no term to renew');
    // The next term starts when the current one ends; an account with no
    // recorded term yet (granted before the revenue ledger) gets one now.
    const next =
      (await this.subscriptions.renew({ userId }, { actorId })) ??
      (await this.subscriptions.startTerm({ userId }, user.plan, { source: 'renewal', actorId }));
    const base = user.planExpiresAt && user.planExpiresAt.getTime() > Date.now() ? user.planExpiresAt : new Date();
    return this.prisma.user.update({
      where: { id: userId },
      data: { planExpiresAt: next?.endsAt ?? planExpiryFor(user.plan, base) },
      select: { id: true, planExpiresAt: true, plan: true },
    });
  }
}

export type AdminUserWithUsage = Prisma.PromiseReturnType<AdminUsageService['listUsersWithUsage']>[number];
