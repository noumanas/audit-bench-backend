import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';
import { UnsubscribeService } from './unsubscribe.service';
import { inactivityEmail } from './templates';

const DAY_MS = 24 * 60 * 60 * 1000;
export const INACTIVE_AFTER_DAYS = 7;
// Same pacing as UpgradeEmailService — stays inside SMTP relay rate limits.
const SEND_GAP_MS = 1500;

export interface InactivityCampaignResult {
  eligible: number;
  sent: number;
  failed: number;
  dryRun: boolean;
  recipients: { email: string; daysInactive: number }[];
}

/**
 * Daily check for accounts with no activity in the last week — no sign-in
 * and no audit or scan (including automatic PR reviews, which mean the
 * product is still working for them). Each inactive stretch gets one email:
 * it only goes again after the user comes back and then goes quiet again.
 */
@Injectable()
export class InactivityEmailService {
  private readonly logger = new Logger(InactivityEmailService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly unsubscribe: UnsubscribeService,
  ) {}

  // Daily, 11:00 UTC — an hour after the Monday upgrade email so the two
  // never land in the same minute.
  @Cron('0 11 * * *', { timeZone: 'UTC' })
  async dailyRun(): Promise<void> {
    if (this.config.get<string>('INACTIVITY_EMAILS_ENABLED') !== 'true') return;
    await this.run();
  }

  async findInactive(now = new Date()): Promise<{ id: string; email: string; name: string | null; daysInactive: number }[]> {
    const cutoff = new Date(now.getTime() - INACTIVE_AFTER_DAYS * DAY_MS);
    const candidates = await this.prisma.user.findMany({
      where: {
        isActive: true,
        marketingEmails: true,
        createdAt: { lt: cutoff },
        OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: cutoff } }],
        audits: { none: { createdAt: { gte: cutoff } } },
        scanJobs: { none: { createdAt: { gte: cutoff } } },
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        lastLoginAt: true,
        lastInactivityEmailAt: true,
        audits: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        scanJobs: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'asc' },
    });

    return candidates
      .map((u) => {
        const lastActivity = Math.max(
          u.createdAt.getTime(),
          u.lastLoginAt?.getTime() ?? 0,
          u.audits[0]?.createdAt.getTime() ?? 0,
          u.scanJobs[0]?.createdAt.getTime() ?? 0,
        );
        return { user: u, lastActivity };
      })
      .filter(({ user, lastActivity }) => !user.lastInactivityEmailAt || user.lastInactivityEmailAt.getTime() < lastActivity)
      .map(({ user, lastActivity }) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        daysInactive: Math.floor((now.getTime() - lastActivity) / DAY_MS),
      }));
  }

  async run({ dryRun = false, now = new Date() } = {}): Promise<InactivityCampaignResult> {
    const recipients = await this.findInactive(now);
    const result: InactivityCampaignResult = {
      eligible: recipients.length,
      sent: 0,
      failed: 0,
      dryRun,
      recipients: recipients.map(({ email, daysInactive }) => ({ email, daysInactive })),
    };
    if (dryRun || recipients.length === 0) return result;

    if (!this.email.isConfigured) {
      this.logger.warn(`Inactivity email: SMTP not configured — skipping ${recipients.length} recipient(s)`);
      return result;
    }
    if (this.running) {
      this.logger.warn('Inactivity email: a run is already in progress — skipping');
      return result;
    }
    this.running = true;
    try {
      for (const [i, user] of recipients.entries()) {
        if (i > 0) await new Promise((r) => setTimeout(r, SEND_GAP_MS));
        try {
          await this.sendTo(user, user.daysInactive);
          await this.prisma.user.update({ where: { id: user.id }, data: { lastInactivityEmailAt: new Date() } });
          result.sent++;
        } catch (err) {
          result.failed++;
          this.logger.error(`Inactivity email to ${user.email} failed: ${(err as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
    this.logger.log(`Inactivity email: sent ${result.sent}/${result.eligible} (${result.failed} failed)`);
    return result;
  }

  /** Renders and sends the email to one user — also used to preview it. */
  async sendTo(user: { id: string; email: string; name: string | null }, daysInactive: number): Promise<void> {
    const { subject, html, text } = inactivityEmail({
      name: user.name,
      daysInactive,
      appOrigin: (this.config.get<string>('FRONTEND_ORIGIN') || 'http://localhost:3000').split(',')[0].trim(),
      unsubscribeUrl: this.unsubscribe.url(user.id),
    });
    await this.email.send(user.email, subject, html, text, this.unsubscribe.headers(user.id));
  }
}
