import { Logger } from '@nestjs/common';

// Pause between sends — keeps us well inside Google's SMTP relay rate limits.
export const SEND_GAP_MS = 1500;

// Reserved for documentation/testing (RFC 2606/6761) — mail to these can
// never be delivered, and the bounces would hurt the sending domain's
// reputation. Test accounts made during development live on these.
const UNDELIVERABLE = /@(?:[^@]+\.)?(?:example\.(?:com|net|org)|example|test|invalid|local|localhost)$/i;

export function isDeliverableAddress(email: string): boolean {
  return !UNDELIVERABLE.test(email.trim());
}

export type CampaignTrigger = 'schedule' | 'manual';

export interface CampaignRun {
  trigger: CampaignTrigger;
  startedAt: Date;
  /** null while the run is still sending. */
  finishedAt: Date | null;
  eligible: number;
  sent: number;
  failed: number;
}

/**
 * The send loop shared by the recurring campaigns (UpgradeEmailService,
 * InactivityEmailService): one recipient at a time, a failure counted and
 * logged without stopping the run, and live progress the admin Emails tab
 * polls. One run at a time per campaign, per process.
 */
export class Campaign {
  private current: CampaignRun | null = null;

  constructor(
    private readonly label: string,
    private readonly logger: Logger,
  ) {}

  get running(): boolean {
    return this.current !== null && this.current.finishedAt === null;
  }

  /** The current run while sending, otherwise the last finished one (this process only). */
  get lastRun(): CampaignRun | null {
    return this.current;
  }

  async execute<T extends { email: string }>(
    recipients: T[],
    trigger: CampaignTrigger,
    sendOne: (recipient: T) => Promise<void>,
  ): Promise<CampaignRun> {
    const run: CampaignRun = {
      trigger,
      startedAt: new Date(),
      finishedAt: null,
      eligible: recipients.length,
      sent: 0,
      failed: 0,
    };
    this.current = run;
    try {
      for (const [i, recipient] of recipients.entries()) {
        if (i > 0) await new Promise((r) => setTimeout(r, SEND_GAP_MS));
        try {
          await sendOne(recipient);
          run.sent++;
        } catch (err) {
          run.failed++;
          this.logger.error(`${this.label} to ${recipient.email} failed: ${(err as Error).message}`);
        }
      }
    } finally {
      run.finishedAt = new Date();
    }
    this.logger.log(`${this.label}: sent ${run.sent}/${run.eligible} (${run.failed} failed)`);
    return run;
  }
}
