import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { deriveRepoKey } from '../common/repo-key';

/** Either the top-level client or a client scoped to an in-flight transaction. */
type Db = Prisma.TransactionClient;

function startOfDay(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfNextDay(d = new Date()): Date {
  const s = startOfDay(d);
  s.setDate(s.getDate() + 1);
  return s;
}

function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfNextMonth(d = new Date()): Date {
  const s = startOfMonth(d);
  s.setMonth(s.getMonth() + 1);
  return s;
}

@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  private loadUserWithPlan(db: Db, userId: string) {
    return db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { plan: true, organization: { include: { plan: true } } },
    });
  }

  /**
   * A user in an organization draws from the org's pooled plan/quota, not
   * their own — their personal `plan` becomes dormant the moment they join
   * a team (see AuthService/UsersService, which still keep it up to date so
   * it's ready to use again if they ever leave).
   */
  private effectivePlan(user: {
    plan: {
      dailyAuditLimit: number | null;
      monthlyAuditLimit: number | null;
      repositoryScan: boolean;
      maxRepositories: number | null;
      alignmentLabEnabled: boolean;
      monthlyInvestigationLimit: number | null;
      name: string;
    };
    organization: { plan: typeof user.plan } | null;
  }) {
    return user.organization ? user.organization.plan : user.plan;
  }

  /**
   * Audits and repository scans both draw from the same quota — one "AI
   * audit" per PRD pricing. Crucially, this only counts rows that actually
   * triggered a fresh LLM call: `Audit.aiInvoked` is copied straight from
   * the pipeline result even on a cache replay, so it's paired with
   * `fromCache: false` here; `ScanJob.aiInvoked` already means "at least
   * one fresh call happened" (see RepositoryService), so it needs no such
   * pairing. A Stage-1-only ("clean") run, or a cache hit, costs nothing.
   *
   * `scopeWhere` is `{ userId }` for a personal account or `{ organizationId }`
   * for a team member — team usage is pooled across every member's runs.
   */
  private async countUsage(
    db: Db,
    scopeWhere: { userId: string } | { organizationId: string },
    since: Date,
  ): Promise<number> {
    const [audits, scans] = await Promise.all([
      db.audit.count({ where: { ...scopeWhere, createdAt: { gte: since }, aiInvoked: true, fromCache: false } }),
      db.scanJob.count({ where: { ...scopeWhere, createdAt: { gte: since }, aiInvoked: true } }),
    ]);
    return audits + scans;
  }

  async getUsage(userId: string, db: Db = this.prisma) {
    const user = await this.loadUserWithPlan(db, userId);
    const plan = this.effectivePlan(user);
    const scopeWhere = user.organizationId ? { organizationId: user.organizationId } : { userId };
    const [dailyUsed, monthlyUsed] = await Promise.all([
      this.countUsage(db, scopeWhere, startOfDay()),
      this.countUsage(db, scopeWhere, startOfMonth()),
    ]);

    return {
      plan,
      scope: user.organizationId ? ('organization' as const) : ('personal' as const),
      organizationName: user.organization?.name ?? null,
      dailyUsed,
      dailyLimit: plan.dailyAuditLimit,
      monthlyUsed,
      monthlyLimit: plan.monthlyAuditLimit,
      dailyResetsAt: startOfNextDay(),
      monthlyResetsAt: startOfNextMonth(),
    };
  }

  /**
   * Throws 429 if the user is out of daily or monthly audit quota. Pass a
   * transaction client when calling this immediately before creating the
   * Audit/ScanJob row (see `withQuotaCheck`) — that's what actually closes
   * the race; a standalone call like this is just a cheap fail-fast before
   * spending money on an LLM call.
   */
  async assertCanRunAudit(userId: string, db: Db = this.prisma): Promise<void> {
    const usage = await this.getUsage(userId, db);

    if (usage.dailyLimit != null && usage.dailyUsed >= usage.dailyLimit) {
      throw new HttpException(
        {
          message: `Daily audit limit reached (${usage.dailyUsed}/${usage.dailyLimit}). Resets at ${usage.dailyResetsAt.toISOString()}.`,
          resetsAt: usage.dailyResetsAt,
          scope: 'daily',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (usage.monthlyLimit != null && usage.monthlyUsed >= usage.monthlyLimit) {
      throw new HttpException(
        {
          message: `Monthly audit limit reached (${usage.monthlyUsed}/${usage.monthlyLimit}). Resets at ${usage.monthlyResetsAt.toISOString()}.`,
          resetsAt: usage.monthlyResetsAt,
          scope: 'monthly',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Throws 403 if the plan excludes repository scanning outright. This is a
   * feature gate, not a quota check — it applies even to a scan that will
   * turn out to need no AI at all, since extraction/static-analysis itself
   * has real server cost. Used for actions on an *existing* scan job (AI
   * fix, fix-all) — see assertCanScanNewRepository for creating a new one,
   * which additionally enforces the plan's repository-count cap.
   */
  async assertPlanAllowsRepositoryScan(userId: string, db: Db = this.prisma): Promise<void> {
    const user = await this.loadUserWithPlan(db, userId);
    const plan = this.effectivePlan(user);
    if (!plan.repositoryScan) {
      throw new ForbiddenException(`Repository scanning isn't included in the ${plan.name} plan. Upgrade to Pro or higher.`);
    }
  }

  /**
   * Gate for starting a scan against `repoKey` (see deriveRepoKey) — the
   * feature check above, plus (when the plan caps distinct repositories,
   * e.g. Free: 1) a lifetime count of repositories already scanned. Scanning
   * a repo already within that count — including reviewing another PR/MR
   * against it — is always allowed; only a genuinely new repository beyond
   * the cap is blocked.
   */
  async assertCanScanNewRepository(userId: string, repoKey: string, db: Db = this.prisma): Promise<void> {
    const user = await this.loadUserWithPlan(db, userId);
    const plan = this.effectivePlan(user);
    if (!plan.repositoryScan) {
      throw new ForbiddenException(`Repository scanning isn't included in the ${plan.name} plan. Upgrade to Pro or higher.`);
    }

    if (plan.maxRepositories != null) {
      const scopeWhere = user.organizationId ? { organizationId: user.organizationId } : { userId };
      const priorScans = await db.scanJob.findMany({
        where: scopeWhere,
        select: { sourceName: true, repoRef: true, prContext: true },
      });
      const seenKeys = new Set(priorScans.map((s) => deriveRepoKey(s)));
      if (!seenKeys.has(repoKey) && seenKeys.size >= plan.maxRepositories) {
        throw new ForbiddenException(
          `The ${plan.name} plan can scan ${plan.maxRepositories} repositor${plan.maxRepositories === 1 ? 'y' : 'ies'}. Upgrade to Pro to scan more.`,
        );
      }
    }
  }

  /**
   * Throws 403 if the plan excludes Alignment Lab outright, or 429 if the
   * org/account is out of monthly investigations — a role check, not just a
   * plan check: admin/super_admin always passes (support/testing), same as
   * the product owner needing to exercise a Team/Enterprise-gated feature
   * without needing to be on a paid plan themselves.
   */
  async assertCanRunInvestigation(
    userId: string,
    role: 'user' | 'admin' | 'super_admin',
    db: Db = this.prisma,
  ): Promise<void> {
    if (role === 'admin' || role === 'super_admin') return;

    const user = await this.loadUserWithPlan(db, userId);
    const plan = this.effectivePlan(user);
    if (!plan.alignmentLabEnabled) {
      throw new ForbiddenException(`Alignment Lab isn't included in the ${plan.name} plan. Upgrade to Team or higher.`);
    }

    if (plan.monthlyInvestigationLimit != null) {
      const scopeWhere = user.organizationId ? { organizationId: user.organizationId } : { userId };
      const used = await db.investigation.count({
        where: { ...scopeWhere, createdAt: { gte: startOfMonth() } },
      });
      if (used >= plan.monthlyInvestigationLimit) {
        throw new HttpException(
          {
            message: `Monthly investigation limit reached (${used}/${plan.monthlyInvestigationLimit}). Resets at ${startOfNextMonth().toISOString()}.`,
            resetsAt: startOfNextMonth(),
            scope: 'monthly',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  /**
   * Atomically re-checks quota and creates the usage-consuming row in one
   * Serializable transaction, so concurrent requests can't all pass the
   * same stale count and all insert (the race a standalone assert* call
   * can't close on its own). Postgres aborts one side of a genuine
   * conflict with a P2034 error, which we retry once.
   */
  async withQuotaCheck<T>(
    checker: (db: Db) => Promise<void>,
    create: (db: Db) => Promise<T>,
    attempt = 0,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          await checker(tx);
          return create(tx);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034' && attempt < 1) {
        return this.withQuotaCheck(checker, create, attempt + 1);
      }
      throw err;
    }
  }
}
