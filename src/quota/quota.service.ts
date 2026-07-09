import { ForbiddenException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

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
      include: { plan: true },
    });
  }

  /**
   * Audits and repository scans both draw from the same quota — one "AI
   * audit" per PRD pricing. Crucially, this only counts rows that actually
   * triggered a fresh LLM call: `Audit.aiInvoked` is copied straight from
   * the pipeline result even on a cache replay, so it's paired with
   * `fromCache: false` here; `ScanJob.aiInvoked` already means "at least
   * one fresh call happened" (see RepositoryService), so it needs no such
   * pairing. A Stage-1-only ("clean") run, or a cache hit, costs nothing.
   */
  private async countUsage(db: Db, userId: string, since: Date): Promise<number> {
    const [audits, scans] = await Promise.all([
      db.audit.count({ where: { userId, createdAt: { gte: since }, aiInvoked: true, fromCache: false } }),
      db.scanJob.count({ where: { userId, createdAt: { gte: since }, aiInvoked: true } }),
    ]);
    return audits + scans;
  }

  async getUsage(userId: string, db: Db = this.prisma) {
    const user = await this.loadUserWithPlan(db, userId);
    const [dailyUsed, monthlyUsed] = await Promise.all([
      this.countUsage(db, userId, startOfDay()),
      this.countUsage(db, userId, startOfMonth()),
    ]);

    return {
      plan: user.plan,
      dailyUsed,
      dailyLimit: user.plan.dailyAuditLimit,
      monthlyUsed,
      monthlyLimit: user.plan.monthlyAuditLimit,
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
   * has real server cost.
   */
  async assertPlanAllowsRepositoryScan(userId: string, db: Db = this.prisma): Promise<void> {
    const user = await this.loadUserWithPlan(db, userId);
    if (!user.plan.repositoryScan) {
      throw new ForbiddenException(
        `Repository scanning isn't included in the ${user.plan.name} plan. Upgrade to Pro or higher.`,
      );
    }
  }

  /** Combined feature-gate + quota check, for callers that don't need to defer the quota half. */
  async assertCanScanRepository(userId: string, db: Db = this.prisma): Promise<void> {
    await this.assertPlanAllowsRepositoryScan(userId, db);
    await this.assertCanRunAudit(userId, db);
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
