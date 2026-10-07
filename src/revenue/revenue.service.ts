import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SubscriptionService, BillingAccount } from './subscription.service';
import { Term, monthlyMovements, mrrByAccount } from './revenue-math';

const DAY_MS = 24 * 60 * 60 * 1000;

const ACCOUNT_INCLUDE = {
  plan: { select: { id: true, slug: true, name: true, priceMonthlyCents: true } },
  user: { select: { id: true, email: true, name: true } },
  organization: { select: { id: true, name: true } },
} as const;

function accountKey(s: { userId: string | null; organizationId: string | null }) {
  return s.userId ? `u:${s.userId}` : `o:${s.organizationId}`;
}

function accountLabel(s: { user: { email: string; name: string | null } | null; organization: { name: string } | null }) {
  return s.organization ? `${s.organization.name} (team)` : (s.user?.email ?? 'Deleted account');
}

function billingAccountOf(s: { userId: string | null; organizationId: string | null }): BillingAccount {
  return s.userId ? { userId: s.userId } : { organizationId: s.organizationId! };
}

/** Super-admin revenue reporting and management (see RevenueController). */
@Injectable()
export class RevenueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
  ) {}

  async overview(months = 12) {
    const now = new Date();
    const subs = await this.prisma.subscription.findMany({ include: ACCOUNT_INCLUDE });
    const terms: Term[] = subs.map((s) => ({
      accountKey: accountKey(s),
      amountCents: s.amountCents,
      startedAt: s.startedAt,
      endsAt: s.endsAt,
      endedAt: s.endedAt,
    }));

    const series = monthlyMovements(terms, months, now);
    const current = series.at(-1)!;
    const lastFull = series.at(-2);
    const beforeLast = series.at(-3);
    const nowByAccount = mrrByAccount(terms, now);
    const mrrCents = [...nowByAccount.values()].reduce((a, b) => a + b, 0);
    const payingAccounts = [...nowByAccount.values()].filter((v) => v > 0).length;

    // Collected revenue per month, from the payment ledger.
    const firstMonth = new Date(`${series[0].month}-01T00:00:00Z`);
    const payments = await this.prisma.payment.findMany({ where: { paidAt: { gte: firstMonth } } });
    const collected = new Map<string, { recurring: number; oneOff: number }>();
    for (const p of payments) {
      const key = p.paidAt.toISOString().slice(0, 7);
      const row = collected.get(key) ?? { recurring: 0, oneOff: 0 };
      if (p.kind === 'subscription') row.recurring += p.amountCents;
      else row.oneOff += p.amountCents;
      collected.set(key, row);
    }
    const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const ytd = await this.prisma.payment.groupBy({
      by: ['kind'],
      where: { paidAt: { gte: yearStart } },
      _sum: { amountCents: true },
    });
    const ytdOf = (k: PaymentKind) => ytd.find((r) => r.kind === k)?._sum.amountCents ?? 0;

    // Plan mix right now.
    const mix = new Map<string, { plan: string; accounts: number; mrrCents: number }>();
    for (const s of subs) {
      const end = s.endedAt && s.endedAt < s.endsAt ? s.endedAt : s.endsAt;
      if (!(s.startedAt <= now && now < end)) continue;
      const row = mix.get(s.plan.slug) ?? { plan: s.plan.name, accounts: 0, mrrCents: 0 };
      row.accounts++;
      row.mrrCents += s.amountCents;
      mix.set(s.plan.slug, row);
    }

    // Terms ending in the next 30 days with no renewal lined up after them.
    const horizon = new Date(now.getTime() + 30 * DAY_MS);
    const latestEndByAccount = new Map<string, Date>();
    for (const s of subs) {
      if (s.status !== 'active') continue;
      const k = accountKey(s);
      if (!latestEndByAccount.has(k) || latestEndByAccount.get(k)! < s.endsAt) latestEndByAccount.set(k, s.endsAt);
    }
    const renewals = subs
      .filter(
        (s) =>
          s.status === 'active' &&
          s.startedAt <= now &&
          s.endsAt > now &&
          s.endsAt <= horizon &&
          latestEndByAccount.get(accountKey(s))?.getTime() === s.endsAt.getTime(),
      )
      .sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime())
      .map((s) => ({
        subscriptionId: s.id,
        account: accountLabel(s),
        plan: s.plan.name,
        amountCents: s.amountCents,
        endsAt: s.endsAt,
        daysLeft: Math.ceil((s.endsAt.getTime() - now.getTime()) / DAY_MS),
      }));

    const churnRatePct =
      lastFull && beforeLast && beforeLast.mrrCents > 0
        ? Math.round((lastFull.churnCents / beforeLast.mrrCents) * 1000) / 10
        : null;

    return {
      currency: 'USD',
      asOf: now,
      mrrCents,
      arrCents: mrrCents * 12,
      payingAccounts,
      arpaCents: payingAccounts ? Math.round(mrrCents / payingAccounts) : 0,
      netNewMrrThisMonthCents:
        current.newCents + current.reactivationCents + current.expansionCents - current.contractionCents - current.churnCents,
      churnRateLastMonthPct: churnRatePct,
      renewalsAtRiskCents: renewals.reduce((sum, r) => sum + r.amountCents, 0),
      collectedThisMonthCents: (() => {
        const row = collected.get(current.month);
        return row ? row.recurring + row.oneOff : 0;
      })(),
      collectedYtdCents: ytd.reduce((sum, r) => sum + (r._sum.amountCents ?? 0), 0),
      oneOffYtdCents: ytdOf('tdd_engagement') + ytdOf('other'),
      series: series.map((m) => ({
        ...m,
        collectedRecurringCents: collected.get(m.month)?.recurring ?? 0,
        collectedOneOffCents: collected.get(m.month)?.oneOff ?? 0,
      })),
      planMix: [...mix.values()].sort((a, b) => b.mrrCents - a.mrrCents),
      renewals,
    };
  }

  async listSubscriptions(status?: string) {
    const now = new Date();
    const rows = await this.prisma.subscription.findMany({
      where:
        status === 'active'
          ? { status: 'active' }
          : status === 'ended'
            ? { status: { in: ['expired', 'canceled'] } }
            : undefined,
      include: ACCOUNT_INCLUDE,
      orderBy: [{ startedAt: 'desc' }],
      take: 500,
    });
    return rows.map((s) => {
      const end = s.endedAt && s.endedAt < s.endsAt ? s.endedAt : s.endsAt;
      return {
        id: s.id,
        account: accountLabel(s),
        accountType: s.organizationId ? ('team' as const) : ('user' as const),
        userId: s.userId,
        organizationId: s.organizationId,
        plan: s.plan,
        amountCents: s.amountCents,
        currency: s.currency,
        startedAt: s.startedAt,
        endsAt: s.endsAt,
        endedAt: s.endedAt,
        status: s.status,
        // What it means right now, for the table's status column.
        state:
          s.status === 'canceled'
            ? ('canceled' as const)
            : s.startedAt > now
              ? ('scheduled' as const)
              : now < end
                ? ('active' as const)
                : ('expired' as const),
        source: s.source,
        notes: s.notes,
      };
    });
  }

  async updateSubscription(id: string, data: { amountCents?: number; notes?: string }) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription not found');
    return this.prisma.subscription.update({
      where: { id },
      data: { amountCents: data.amountCents, notes: data.notes },
    });
  }

  /** Renew the subscription's account and extend its plan access to match. */
  async renew(id: string, actorId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription not found');
    const account = billingAccountOf(sub);
    const next = await this.subscriptions.renew(account, { actorId });
    if (!next) throw new BadRequestException('Nothing to renew: this account has no active subscription.');
    await this.setPlanAccess(account, next.planId, next.endsAt);
    return next;
  }

  /**
   * End a subscription now. With downgrade, the account also moves to Free
   * immediately; without it, plan access runs to the end of the paid term.
   */
  async cancel(id: string, downgrade: boolean) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscription not found');
    const account = billingAccountOf(sub);
    const now = new Date();
    if (downgrade) {
      await this.subscriptions.closeOpenTerms(account, now);
      const free = await this.prisma.plan.findUniqueOrThrow({ where: { slug: 'free' } });
      await this.setPlanAccess(account, free.id, null);
    } else {
      // Stop renewals scheduled after this term; the running term ends as planned.
      await this.prisma.subscription.updateMany({
        where: { ...('userId' in account ? { userId: account.userId } : { organizationId: account.organizationId }), status: 'active', startedAt: { gt: now } },
        data: { status: 'canceled', endedAt: now },
      });
      await this.prisma.subscription.update({ where: { id }, data: { notes: sub.notes ?? 'Will not renew' } });
    }
    return { ok: true };
  }

  private async setPlanAccess(account: BillingAccount, planId: string, expiresAt: Date | null) {
    if ('userId' in account) {
      await this.prisma.user.update({ where: { id: account.userId }, data: { planId, planExpiresAt: expiresAt } });
    } else {
      await this.prisma.organization.update({ where: { id: account.organizationId }, data: { planId, planExpiresAt: expiresAt } });
    }
  }

  async listPayments() {
    const rows = await this.prisma.payment.findMany({
      orderBy: { paidAt: 'desc' },
      take: 500,
      include: {
        user: { select: { email: true } },
        organization: { select: { name: true } },
        subscription: { select: { plan: { select: { name: true } } } },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      amountCents: p.amountCents,
      currency: p.currency,
      kind: p.kind,
      method: p.method,
      reference: p.reference,
      payer: p.organization ? `${p.organization.name} (team)` : (p.user?.email ?? p.payerName ?? '—'),
      plan: p.subscription?.plan.name ?? null,
      paidAt: p.paidAt,
      notes: p.notes,
    }));
  }

  async recordPayment(
    actorId: string,
    data: {
      amountCents: number;
      paidAt: string;
      kind: PaymentKind;
      method?: string;
      reference?: string;
      payerName?: string;
      notes?: string;
      subscriptionId?: string;
    },
  ) {
    let owner: { userId?: string | null; organizationId?: string | null } = {};
    if (data.subscriptionId) {
      const sub = await this.prisma.subscription.findUnique({ where: { id: data.subscriptionId } });
      if (!sub) throw new BadRequestException('Unknown subscription');
      owner = { userId: sub.userId, organizationId: sub.organizationId };
    } else if (!data.payerName?.trim()) {
      throw new BadRequestException('Choose a subscription or enter who paid.');
    }
    return this.prisma.payment.create({
      data: {
        ...owner,
        subscriptionId: data.subscriptionId ?? null,
        amountCents: data.amountCents,
        kind: data.kind,
        method: data.method?.trim() || null,
        reference: data.reference?.trim() || null,
        payerName: data.payerName?.trim() || null,
        notes: data.notes?.trim() || null,
        paidAt: new Date(data.paidAt),
        recordedById: actorId,
      },
    });
  }

  async deletePayment(id: string) {
    await this.prisma.payment.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('Payment not found');
    });
    return { ok: true };
  }
}
