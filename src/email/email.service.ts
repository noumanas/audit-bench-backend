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
          })
        : null;
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  async send(to: string, subject: string, html: string, text: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`SMTP not configured — would have sent to ${to}: "${subject}"\n${text}`);
      return;
    }

    const from = this.config.get<string>('SMTP_FROM') || '"audit/bench" <no-reply@audit-bench.dev>';
    await this.transporter.sendMail({ from, to, subject, html, text });
  }
}
