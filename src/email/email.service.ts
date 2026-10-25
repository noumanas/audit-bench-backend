import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

/**
 * SMTP is optional — with no SMTP_* env vars set, `send` logs the email
 * instead of throwing, so invite creation (etc.) still works end-to-end in
 * dev/self-host without a mail provider configured. Callers that also need
 * the raw link (e.g. an "copy invite link" button) should build and return
 * it themselves rather than depending on this ever actually delivering.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transporter: nodemailer.Transporter | null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<string>('SMTP_PORT');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    this.transporter =
      host && port && user && pass
        ? nodemailer.createTransport({
            host,
            port: Number(port),
            secure: this.config.get<string>('SMTP_SECURE') === 'true',
            auth: { user, pass },
            // The EHLO greeting. Left unset, nodemailer sends the machine's
            // hostname, or "[127.0.0.1]" when that has no dot — which is what
            // a container (Cloud Run, Docker) has, and Google's SMTP relay
            // refuses it: "421 4.7.0 Try again later, closing connection. (EHLO)".
            name: this.config.get<string>('SMTP_EHLO_NAME') || ehloNameFor(user),
          })
        : null;
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  async send(
    to: string,
    subject: string,
    html: string,
    text: string,
    headers?: Record<string, string>,
    replyTo?: string,
  ): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`SMTP not configured — would have sent to ${to}: "${subject}"\n${text}`);
      return;
    }

    // Display name only — the address itself is left as the domain SMTP is
    // actually configured/verified for (SPF/DKIM), not the newer auditbenchai.com.
    const from = this.config.get<string>('SMTP_FROM') || '"Audit Bench Ai" <no-reply@audit-bench.dev>';
    await this.transporter.sendMail({ from, to, subject, html, text, headers, replyTo });
  }
}

/** A real domain to greet the SMTP server with — the sending account's own. */
export function ehloNameFor(smtpUser: string): string | undefined {
  const domain = smtpUser.split('@')[1]?.trim();
  return domain && domain.includes('.') ? domain : undefined;
}
