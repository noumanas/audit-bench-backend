import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ActivityType, Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { newSignupTeamEmail } from '../email/templates';
import { teamInbox } from '../common/team-inbox';
import { AttributionDto, signupSource } from './attribution';
import { EMPTY_CONTEXT, RequestContext, requestContext } from './request-context';

const DEFAULT_RETENTION_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
// What the admin bell surfaces — the two events someone should act on.
const NOTIFY_TYPES: ActivityType[] = ['signup', 'plan_requested'];
const VALID_TYPES = new Set<string>(Object.values(ActivityType));

const LOG_USER_SELECT = { select: { id: true, email: true, name: true } } as const;

export interface LogInput {
  type: ActivityType;
  userId?: string | null;
  email?: string | null;
  method?: string | null;
  ctx?: RequestContext;
  metadata?: Prisma.InputJsonValue;
}

export function formatLocation(parts: { city?: string | null; region?: string | null; countryCode?: string | null }) {
  const label = [parts.city, parts.region, parts.countryCode].filter(Boolean).join(', ');
  return label || null;
}

/**
 * Admin-visible activity trail: who signed up, signed in (or failed to), and
 * filed or had a plan request decided — with IP and approximate location.
 * Logging never throws: it's observability, and a failed insert must not
 * fail the sign-in or request it describes.
 */
@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  context(req: Request): RequestContext {
    return requestContext(req, this.config.get<string>('TRUST_GEO_HEADERS') === 'true');
  }

  async log({ type, userId, email, method, ctx = EMPTY_CONTEXT, metadata }: LogInput): Promise<void> {
    await this.prisma.activityLog
      .create({
        data: {
          type,
          userId: userId ?? null,
          email: email ?? null,
          method: method ?? null,
          ip: ctx.ip,
          countryCode: ctx.countryCode,
          region: ctx.region,
          city: ctx.city,
          userAgent: ctx.userAgent,
          metadata,
        },
      })
      .catch((err: Error) => this.logger.error(`Activity log (${type}) failed: ${err.message}`));
  }

  private origins(): string[] {
    return (this.config.get<string>('FRONTEND_ORIGIN') || 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  /**
   * Stamps the onboarding attribution on a brand-new account, logs the
   * signup and tells the team inbox. Awaited by callers (Cloud Run throttles
   * CPU after the response); every step swallows its own failure.
   */
  async recordSignup(
    user: { id: string; email: string; name: string | null },
    method: string,
    ctx: RequestContext,
    attribution?: AttributionDto,
  ): Promise<void> {
    const source = signupSource(attribution, this.origins());
    const campaign = attribution?.utmCampaign?.trim() || null;

    await this.prisma.user
      .update({
        where: { id: user.id },
        data: {
          signupMethod: method,
          signupSource: source,
          signupCampaign: campaign,
          signupCountry: ctx.countryCode,
          signupRegion: ctx.region,
          signupCity: ctx.city,
        },
      })
      .catch((err: Error) => this.logger.error(`Signup attribution for ${user.id} failed: ${err.message}`));

    await this.log({
      type: 'signup',
      userId: user.id,
      email: user.email,
      method,
      ctx,
      metadata: {
        source,
        campaign,
        utmMedium: attribution?.utmMedium ?? null,
        referrer: attribution?.referrer ?? null,
        landingPath: attribution?.landingPath ?? null,
      },
    });

    if (this.config.get<string>('SIGNUP_NOTIFY_EMAILS') === 'false') return;
    const message = newSignupTeamEmail({
      name: user.name,
      email: user.email,
      method,
      source,
      campaign,
      location: formatLocation(ctx),
      signedUpAt: new Date(),
      adminUrl: `${this.origins()[0]}/app/admin?tab=activity`,
    });
    await this.email
      .send(teamInbox(this.config), message.subject, message.html, message.text, undefined, user.email)
      .catch((err: Error) => this.logger.error(`Signup notification for ${user.id} failed: ${err.message}`));
  }

  // ---------- admin queries ----------

  async list(filters: { type?: string; q?: string; userId?: string; cursor?: string; limit?: number }) {
    if (filters.type && !VALID_TYPES.has(filters.type)) {
      throw new BadRequestException(`Unknown activity type "${filters.type}"`);
    }
    const take = Math.min(Math.max(filters.limit ?? 50, 1), 100);
    const q = filters.q?.trim();
    const where: Prisma.ActivityLogWhereInput = {
      ...(filters.type ? { type: filters.type as ActivityType } : {}),
      ...(filters.userId ? { userId: filters.userId } : {}),
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: 'insensitive' } },
              { ip: { startsWith: q } },
              { city: { contains: q, mode: 'insensitive' } },
              ...(/^[a-z]{2}$/i.test(q) ? [{ countryCode: q.toUpperCase() }] : []),
            ],
          }
        : {}),
    };
    const rows = await this.prisma.activityLog.findMany({
      where,
      include: { user: LOG_USER_SELECT },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > take;
    const items = hasMore ? rows.slice(0, take) : rows;
    return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
  }

  async summary(now = new Date()) {
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const since = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const last30 = since(30);

    const [signupsToday, signups7d, signups30d, logins24h, failedLogins24h, pendingRequests, sources, methods, countries] =
      await Promise.all([
        this.prisma.user.count({ where: { createdAt: { gte: startOfDay } } }),
        this.prisma.user.count({ where: { createdAt: { gte: since(7) } } }),
        this.prisma.user.count({ where: { createdAt: { gte: last30 } } }),
        this.prisma.activityLog.count({ where: { type: 'login', createdAt: { gte: since(1) } } }),
        this.prisma.activityLog.count({ where: { type: 'login_failed', createdAt: { gte: since(1) } } }),
        this.prisma.planRequest.count({ where: { status: 'pending' } }),
        this.prisma.user.groupBy({
          by: ['signupSource'],
          where: { createdAt: { gte: last30 }, signupSource: { not: null } },
          _count: { _all: true },
          orderBy: { _count: { signupSource: 'desc' } },
          take: 6,
        }),
        this.prisma.user.groupBy({
          by: ['signupMethod'],
          where: { createdAt: { gte: last30 }, signupMethod: { not: null } },
          _count: { _all: true },
        }),
        // Distinct people per country across sign-ins and sign-ups, not raw event counts.
        this.prisma.$queryRaw<{ countryCode: string; users: bigint }[]>`
          SELECT "countryCode", COUNT(DISTINCT "userId") AS users
          FROM "ActivityLog"
          WHERE "createdAt" >= ${last30} AND "countryCode" IS NOT NULL AND "userId" IS NOT NULL
            AND "type" IN ('signup', 'login')
          GROUP BY "countryCode" ORDER BY users DESC LIMIT 8`,
      ]);

    return {
      signupsToday,
      signups7d,
      signups30d,
      logins24h,
      failedLogins24h,
      pendingRequests,
      topSources: sources.map((s) => ({ source: s.signupSource as string, count: s._count._all })),
      methods: methods.map((m) => ({ method: m.signupMethod as string, count: m._count._all })),
      topCountries: countries.map((c) => ({ countryCode: c.countryCode, users: Number(c.users) })),
    };
  }

  async notifications(adminId: string) {
    const admin = await this.prisma.user.findUniqueOrThrow({
      where: { id: adminId },
      select: { notificationsSeenAt: true },
    });
    // Never opened the bell: only the last week counts as unread, not all history.
    const seenAt = admin.notificationsSeenAt ?? new Date(Date.now() - 7 * DAY_MS);
    const [unreadCount, items] = await Promise.all([
      this.prisma.activityLog.count({ where: { type: { in: NOTIFY_TYPES }, createdAt: { gt: seenAt } } }),
      this.prisma.activityLog.findMany({
        where: { type: { in: NOTIFY_TYPES } },
        include: { user: LOG_USER_SELECT },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);
    return { unreadCount, seenAt, items };
  }

  async markNotificationsSeen(adminId: string) {
    await this.prisma.user.update({ where: { id: adminId }, data: { notificationsSeenAt: new Date() } });
    return { ok: true };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune(now = new Date()): Promise<number> {
    const days = Number(this.config.get<string>('ACTIVITY_RETENTION_DAYS')) || DEFAULT_RETENTION_DAYS;
    const { count } = await this.prisma.activityLog.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - days * DAY_MS) } },
    });
    if (count) this.logger.log(`Activity log: pruned ${count} row(s) older than ${days} days`);
    return count;
  }
}
