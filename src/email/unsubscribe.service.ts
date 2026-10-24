import * as crypto from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Signed unsubscribe links for non-transactional mail (upgrade nudges,
 * inactivity reminders). The HMAC token is what proves the link came from
 * one of our emails, so nobody can unsubscribe someone else by guessing an id.
 */
@Injectable()
export class UnsubscribeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  token(userId: string): string {
    const secret = this.config.get<string>('JWT_SECRET') ?? '';
    return crypto.createHmac('sha256', secret).update(`unsubscribe:${userId}`).digest('hex');
  }

  verify(userId: string, token: string): boolean {
    const expected = Buffer.from(this.token(userId));
    const given = Buffer.from(token);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  }

  url(userId: string): string {
    const backend = (this.config.get<string>('BACKEND_ORIGIN') || 'http://localhost:4000').replace(/\/$/, '');
    return `${backend}/email/unsubscribe?u=${encodeURIComponent(userId)}&t=${this.token(userId)}`;
  }

  /** RFC 8058 one-click headers — Gmail/Yahoo show them as an unsubscribe button. */
  headers(userId: string): Record<string, string> {
    return {
      'List-Unsubscribe': `<${this.url(userId)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }

  async unsubscribe(userId: string): Promise<void> {
    await this.prisma.user.updateMany({ where: { id: userId }, data: { marketingEmails: false } });
  }
}
