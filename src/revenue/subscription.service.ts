import { Injectable } from '@nestjs/common';
import { Plan, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { planExpiryFor } from '../common/plan-expiry';

/** Whose plan it is: a personal account or an organization's shared plan. */
export type BillingAccount = { userId: string } | { organizationId: string };

function where(account: BillingAccount): Prisma.SubscriptionWhereInput {
  return 'userId' in account ? { userId: account.userId } : { organizationId: account.organizationId };
}

function owner(account: BillingAccount) {
  return 'userId' in account ? { userId: account.userId } : { organizationId: account.organizationId };
}

/**
 * The subscription ledger behind the revenue dashboard. Every paid plan term
 * the app grants (approval, admin plan change, renewal) is recorded here, so
 * MRR history survives later plan changes. Plan access itself still comes
 * from User/Organization.planId + planExpiresAt; this records the money side.
 */
@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Close whatever term the account is on (and any renewal scheduled after
   * it) and, for a paid plan, open a new 30-day term at the plan's price.
   * Enterprise has no list price, so it keeps the account's last
   * Enterprise amount if there was one.
   */
  async startTerm(
    account: BillingAccount,
    plan: Plan,
    opts: { source: string; actorId?: string | null; now?: Date } = { source: 'admin' },
  ) {
    const now = opts.now ?? new Date();
    await this.closeOpenTerms(account, now);
    if (plan.slug === 'free') return null;

    let amountCents = plan.priceMonthlyCents;
    if (amountCents === 0) {
      const previous = await this.prisma.subscription.findFirst({
        where: { ...where(account), planId: plan.id, amountCents: { gt: 0 } },
        orderBy: { startedAt: 'desc' },
      });
      amountCents = previous?.amountCents ?? 0;
    }

    return this.prisma.subscription.create({
      data: {
        ...owner(account),
        planId: plan.id,
        amountCents,
        startedAt: now,
        endsAt: planExpiryFor(plan, now)!,
        source: opts.source,
        createdById: opts.actorId ?? null,
      },
    });
  }

  /**
   * Adds the next 30-day term, starting when the current one ends (so
   * renewing early never loses days) or now if it already lapsed. Same plan
   * and amount as the latest term. Returns the new term, or null if the
   * account has never had a paid term.
   */
  async renew(account: BillingAccount, opts: { actorId?: string | null; now?: Date } = {}) {
    const now = opts.now ?? new Date();
    const latest = await this.prisma.subscription.findFirst({
      where: { ...where(account), status: 'active' },
      orderBy: { endsAt: 'desc' },
      include: { plan: true },
    });
    if (!latest) return null;
    const start = latest.endsAt > now ? latest.endsAt : now;
    return this.prisma.subscription.create({
      data: {
        ...owner(account),
        planId: latest.planId,
        amountCents: latest.amountCents,
        currency: latest.currency,
        startedAt: start,
        endsAt: planExpiryFor(latest.plan, start)!,
        source: 'renewal',
        createdById: opts.actorId ?? null,
      },
    });
  }

  /** Stop the running term now and drop any renewal scheduled after it. */
  async closeOpenTerms(account: BillingAccount, now = new Date()) {
    await this.prisma.$transaction([
      // Renewals that haven't started yet never happen.
      this.prisma.subscription.updateMany({
        where: { ...where(account), status: 'active', startedAt: { gt: now } },
        data: { status: 'canceled', endedAt: now },
      }),
      this.prisma.subscription.updateMany({
        where: { ...where(account), status: 'active', startedAt: { lte: now }, endsAt: { gt: now } },
        data: { status: 'canceled', endedAt: now },
      }),
    ]);
  }

  /** Terms that ran their full course: active → expired (see PlanExpiryService). */
  markExpired(now = new Date()) {
    return this.prisma.subscription.updateMany({
      where: { status: 'active', endsAt: { lte: now } },
      data: { status: 'expired' },
    });
  }
}
