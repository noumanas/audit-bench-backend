import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { EmailService } from './email.service';
import { UnsubscribeService } from './unsubscribe.service';
import { upgradeEmail } from './templates';

// Cron fires weekly, but "already emailed" is judged with a little slack so
// a run that drifts a few hours later next week still goes out.
const RESEND_AFTER_MS = 6 * 24 * 60 * 60 * 1000;
// Pause between sends — keeps us well inside Google's SMTP relay rate limits.
const SEND_GAP_MS = 1500;

export interface UpgradeCampaignResult {
  eligible: number;
  sent: number;
  failed: number;
  dryRun: boolean;
  recipients: string[];
}

/**
 * Weekly "upgrade to Pro" email to every active Free-plan user who hasn't
 * unsubscribed. Only personal accounts — a team member's plan is the
 * organization's, and upgrading it is the owner's call, not theirs.
 */
@Injectable()
export class UpgradeEmailService {
  private readonly logger = new Logger(UpgradeEmailService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
    private readonly quota: QuotaService,
    private readonly unsubscribe: UnsubscribeService,
  ) {}

  // Mondays 10:00 UTC.
  @Cron('0 10 * * 1', { timeZone: 'UTC' })
  async weeklyRun(): Promise<void> {
    if (this.config.get<string>('UPGRADE_EMAILS_ENABLED') !== 'true') return;
    await this.run();
  }

  async run({ dryRun = false, now = new Date() } = {}): Promise<UpgradeCampaignResult> {
    const recipients = await this.prisma.user.findMany({
      where: {
        isActive: true,
        marketingEmails: true,
        organizationId: null,
        plan: { slug: 'free' },
        OR: [{ lastUpgradeEmailAt: null }, { lastUpgradeEmailAt: { lt: new Date(now.getTime() - RESEND_AFTER_MS) } }],
      },
      select: { id: true, email: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    const result: UpgradeCampaignResult = {
      eligible: recipients.length,
      sent: 0,
      failed: 0,
      dryRun,
      recipients: recipients.map((r) => r.email),
    };
    if (dryRun || recipients.length === 0) return result;

    if (!this.email.isConfigured) {
      this.logger.warn(`Upgrade email: SMTP not configured — skipping ${recipients.length} recipient(s)`);
      return result;
    }
    if (this.running) {
      this.logger.warn('Upgrade email: a run is already in progress — skipping');
      return result;
    }
    this.running = true;
    try {
      const [free, pro] = await Promise.all([
        this.prisma.plan.findUniqueOrThrow({ where: { slug: 'free' } }),
        this.prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } }),
      ]);
      for (const [i, user] of recipients.entries()) {
        if (i > 0) await new Promise((r) => setTimeout(r, SEND_GAP_MS));
        try {
          await this.sendTo(user, free, pro);
          await this.prisma.user.update({ where: { id: user.id }, data: { lastUpgradeEmailAt: new Date() } });
          result.sent++;
        } catch (err) {
          result.failed++;
          this.logger.error(`Upgrade email to ${user.email} failed: ${(err as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
    this.logger.log(`Upgrade email: sent ${result.sent}/${result.eligible} (${result.failed} failed)`);
    return result;
  }

  /** Renders and sends the email to one user — also used to preview it. */
  async sendTo(
    user: { id: string; email: string; name: string | null },
    free?: Parameters<typeof upgradeEmail>[0]['free'],
    pro?: Parameters<typeof upgradeEmail>[0]['pro'],
  ): Promise<void> {
    free ??= await this.prisma.plan.findUniqueOrThrow({ where: { slug: 'free' } });
    pro ??= await this.prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } });
    const usage = await this.quota.getUsage(user.id).catch(() => null);
    const { subject, html, text } = upgradeEmail({
      name: user.name,
      free,
      pro,
      pricingUrl: `${this.frontendOrigin()}/pricing`,
      unsubscribeUrl: this.unsubscribe.url(user.id),
      auditsUsed: usage?.monthlyUsed,
      auditLimit: usage?.monthlyLimit,
    });
    await this.email.send(user.email, subject, html, text, this.unsubscribe.headers(user.id));
  }

  private frontendOrigin(): string {
    return (this.config.get<string>('FRONTEND_ORIGIN') || 'http://localhost:3000').split(',')[0].trim();
  }
}
