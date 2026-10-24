import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { PlanLimits, welcomeEmail } from './templates';

/**
 * Welcome email for a brand-new account (password signup or first OAuth
 * login). Transactional, so it ignores User.marketingEmails. Fire-and-forget:
 * the account already exists by the time this runs, so a mail failure is
 * logged and never fails the signup itself.
 */
@Injectable()
export class WelcomeEmailService {
  private readonly logger = new Logger(WelcomeEmailService.name);

  constructor(
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  send(user: { email: string; name: string | null; plan: Pick<PlanLimits, 'name' | 'monthlyAuditLimit' | 'maxRepositories'> }): void {
    const { subject, html, text } = welcomeEmail({
      name: user.name,
      plan: user.plan,
      appOrigin: (this.config.get<string>('FRONTEND_ORIGIN') || 'http://localhost:3000').split(',')[0].trim(),
    });
    this.email
      .send(user.email, subject, html, text)
      .catch((err: Error) => this.logger.error(`Welcome email to ${user.email} failed: ${err.message}`));
  }
}
