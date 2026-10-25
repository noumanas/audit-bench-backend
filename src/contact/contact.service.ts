import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { contactConfirmationEmail, contactTeamEmail } from '../email/templates';
import { CONTACT_TOPICS, ContactDto } from './contact.dto';

@Injectable()
export class ContactService {
  private readonly logger = new Logger(ContactService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  /** Where contact-form messages are delivered — defaults to the sending account's own mailbox. */
  private inbox(): string | undefined {
    return this.config.get<string>('CONTACT_INBOX') || this.config.get<string>('SMTP_USER');
  }

  /**
   * Saves the message first (a mail outage never loses it), then emails the
   * team inbox and a confirmation to the visitor. Both sends are awaited
   * before responding — on Cloud Run the CPU is throttled once the response
   * is sent — but a mail failure never fails the request: it's saved.
   */
  async submit(dto: ContactDto): Promise<{ received: true }> {
    // Honeypot filled → a bot. Answer exactly like a success so it learns nothing.
    if (dto.website) {
      this.logger.warn(`Contact form: honeypot tripped by ${dto.email} — dropped`);
      return { received: true };
    }

    const topicLabel = CONTACT_TOPICS[dto.topic];
    const saved = await this.prisma.contactMessage.create({
      data: { name: dto.name, email: dto.email, company: dto.company || null, topic: dto.topic, message: dto.message },
    });

    const inbox = this.inbox();
    if (!inbox) {
      this.logger.warn(`Contact form: no CONTACT_INBOX/SMTP_USER — message ${saved.id} saved but not emailed`);
      return { received: true };
    }

    const team = contactTeamEmail({ ...dto, company: dto.company || null, topicLabel, receivedAt: saved.createdAt });
    const confirmation = contactConfirmationEmail({
      name: dto.name,
      topicLabel,
      appOrigin: (this.config.get<string>('FRONTEND_ORIGIN') || 'http://localhost:3000').split(',')[0].trim(),
    });

    await Promise.all([
      this.email
        .send(inbox, team.subject, team.html, team.text, undefined, `${dto.name.replace(/["<>]/g, '')} <${dto.email}>`)
        .then(() => this.prisma.contactMessage.update({ where: { id: saved.id }, data: { emailedAt: new Date() } }))
        .catch((err: Error) => this.logger.error(`Contact form: team email for ${saved.id} failed: ${err.message}`)),
      this.email
        .send(dto.email, confirmation.subject, confirmation.html, confirmation.text)
        .catch((err: Error) => this.logger.error(`Contact form: confirmation to ${dto.email} failed: ${err.message}`)),
    ]);
    return { received: true };
  }
}
