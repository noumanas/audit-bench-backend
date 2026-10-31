import { ConfigService } from '@nestjs/config';

/**
 * Where the team is told about new sign-ups and paid plan requests (paid
 * plans are paid off-site, so someone has to match each request to its
 * payment). Separate from CONTACT_INBOX, which takes contact-form mail.
 */
export function teamInbox(config: ConfigService): string {
  return config.get<string>('ADMIN_NOTIFY_INBOX') || 'hello@auditbenchai.com';
}
