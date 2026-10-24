import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { EmailService } from './email.service';
import { UnsubscribeService } from './unsubscribe.service';
import { upgradeEmail } from './templates';
import { Campaign, CampaignTrigger, isDeliverableAddress } from './campaign';

// Cron fires weekly, but "already emailed" is judged with a little slack so
// a run that drifts a few hours later next week still goes out.
const RESEND_AFTER_MS = 6 * 24 * 60 * 60 * 1000;
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
  private readonly campaign = new Campaign('Upgrade email', this.logger);

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

  /** Who this week's email would go to right now. */
  async findRecipients(now = new Date()): Promise<{ id: string; email: string; name: string | null }[]> {
    const users = await this.prisma.user.findMany({
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
    return users.filter((u) => isDeliverableAddress(u.email));
  }

  async run({ dryRun = false, now = new Date(), trigger = 'schedule' as CampaignTrigger } = {}): Promise<UpgradeCampaignResult> {
    const recipients = await this.findRecipients(now);
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
    const plans = await this.loadPlans();
    // After every await — execute() marks the run as started synchronously.
    if (this.campaign.running) {
      this.logger.warn('Upgrade email: a run is already in progress — skipping');
      return result;
    }
    const run = await this.campaign.execute(recipients, trigger, (user) => this.sendAndRecord(user, plans));
    return { ...result, sent: run.sent, failed: run.failed };
  }

  private async loadPlans() {
    const [free, pro] = await Promise.all([
      this.prisma.plan.findUniqueOrThrow({ where: { slug: 'free' } }),
      this.prisma.plan.findUniqueOrThrow({ where: { slug: 'pro' } }),
    ]);
    return { free, pro };
  }

  private async sendAndRecord(
    user: { id: string; email: string; name: string | null },
    { free, pro }: Awaited<ReturnType<UpgradeEmailService['loadPlans']>>,
  ) {
    await this.sendTo(user, free, pro);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastUpgradeEmailAt: new Date() } });
  }

  /**
   * Admin "Send now": sends to everyone eligible right now, ignoring the
   * schedule and UPGRADE_EMAILS_ENABLED, but still never re-sending to
   * someone emailed in the last 6 days. Returns as soon as sending starts —
   * progress is in status().
   */
  async start(): Promise<{ started: true; eligible: number }> {
    if (!this.email.isConfigured) throw new ConflictException('SMTP is not configured on the server');
    if (this.campaign.running) throw new ConflictException('This email is already being sent');
    const [recipients, plans] = await Promise.all([this.findRecipients(), this.loadPlans()]);
    // Checked again after the await — execute() marks the run as started
    // synchronously, so two quick clicks can't both get past this.
    if (this.campaign.running) throw new ConflictException('This email is already being sent');
    if (recipients.length === 0) throw new ConflictException('Nobody is eligible for this email right now');
    this.campaign
      .execute(recipients, 'manual', (user) => this.sendAndRecord(user, plans))
      .catch((err: Error) => this.logger.error(`Upgrade email run failed: ${err.message}`));
    return { started: true, eligible: recipients.length };
  }

  status() {
    return {
      enabled: this.config.get<string>('UPGRADE_EMAILS_ENABLED') === 'true',
      schedule: 'Mondays 10:00 UTC',
      running: this.campaign.running,
      lastRun: this.campaign.lastRun,
    };
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
