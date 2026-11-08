import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { passwordChangedEmail, passwordResetCodeEmail } from '../email/templates';
import { ActivityService } from '../activity/activity.service';
import { RequestContext } from '../activity/request-context';
import { AuthService, SALT_ROUNDS } from './auth.service';
import { requireJwtSecret } from './jwt-secret';

export const CODE_TTL_MINUTES = 10;
const RESET_TOKEN_TTL_MINUTES = 15;
/** Wrong codes allowed before the attempt is cancelled and a new code is needed. */
export const MAX_CODE_ATTEMPTS = 5;
/** A new code can't be sent more often than this, per account. */
export const RESEND_COOLDOWN_MS = 60_000;

const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000);
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/** One message for every way a code or token can be wrong, so failures don't reveal which. */
const INVALID_CODE = 'That code is invalid or has expired. Request a new one.';
const INVALID_LINK = 'This reset has expired. Start again to get a new code.';

/**
 * Forgot password in three steps:
 * 1. requestCode: email a 6-digit code (always answers the same way, so it
 *    can't be used to find out which emails have accounts);
 * 2. verifyCode: trade the right code for a short-lived reset token, with a
 *    limited number of guesses;
 * 3. resetPassword: spend the token to set the new password. Sessions issued
 *    before that are rejected from then on (see JwtStrategy), and the owner
 *    is emailed that the password changed.
 * Only an HMAC of the code and a hash of the token are ever stored.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly activity: ActivityService,
  ) {}

  private codeHash(userId: string, code: string): string {
    return crypto.createHmac('sha256', requireJwtSecret(this.config)).update(`${userId}:${code}`).digest('hex');
  }

  async requestCode(email: string): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, isActive: true, passwordReset: { select: { sentAt: true } } },
    });
    // Unknown and suspended accounts get the same answer as real ones.
    if (!user || !user.isActive) return { ok: true };
    const lastSent = user.passwordReset?.sentAt;
    if (lastSent && Date.now() - lastSent.getTime() < RESEND_COOLDOWN_MS) return { ok: true };

    const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
    const fresh = {
      codeHash: this.codeHash(user.id, code),
      codeExpiresAt: minutesFromNow(CODE_TTL_MINUTES),
      attempts: 0,
      resetTokenHash: null,
      resetTokenExpiresAt: null,
      sentAt: new Date(),
    };
    await this.prisma.passwordReset.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...fresh },
      update: fresh,
    });

    const message = passwordResetCodeEmail({ name: user.name, code, expiresInMinutes: CODE_TTL_MINUTES });
    // Not awaited: waiting on SMTP would make known emails measurably slower to answer than unknown ones.
    this.email
      .send(user.email, message.subject, message.html, message.text)
      .catch((err) => this.logger.error(`Password reset email to ${user.id} failed: ${(err as Error).message}`));
    return { ok: true };
  }

  async verifyCode(email: string, code: string): Promise<{ resetToken: string }> {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true, isActive: true } });
    const reset = user?.isActive ? await this.prisma.passwordReset.findUnique({ where: { userId: user.id } }) : null;
    if (!user || !reset?.codeHash || reset.codeExpiresAt < new Date()) throw new BadRequestException(INVALID_CODE);

    if (!sameHash(this.codeHash(user.id, code), reset.codeHash)) {
      const attempts = reset.attempts + 1;
      if (attempts >= MAX_CODE_ATTEMPTS) {
        await this.prisma.passwordReset.delete({ where: { userId: user.id } });
        throw new BadRequestException('Too many wrong codes. Request a new code to try again.');
      }
      await this.prisma.passwordReset.update({ where: { userId: user.id }, data: { attempts } });
      throw new BadRequestException(INVALID_CODE);
    }

    const resetToken = crypto.randomBytes(32).toString('base64url');
    await this.prisma.passwordReset.update({
      where: { userId: user.id },
      data: {
        codeHash: null, // a code works once
        resetTokenHash: sha256(resetToken),
        resetTokenExpiresAt: minutesFromNow(RESET_TOKEN_TTL_MINUTES),
      },
    });
    return { resetToken };
  }

  async resetPassword(email: string, resetToken: string, password: string, ctx: RequestContext) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { plan: true, organization: true, passwordReset: true },
    });
    const reset = user?.passwordReset;
    const valid =
      user?.isActive &&
      reset?.resetTokenHash &&
      reset.resetTokenExpiresAt &&
      reset.resetTokenExpiresAt > new Date() &&
      sameHash(sha256(resetToken), reset.resetTokenHash);
    if (!user || !valid) throw new BadRequestException(INVALID_LINK);

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    // Whole seconds, matching the JWT `iat` it's compared with: the session issued below stays valid.
    const passwordChangedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt } }),
      this.prisma.passwordReset.delete({ where: { userId: user.id } }),
    ]);
    await this.activity.log({ type: 'password_reset', userId: user.id, email: user.email, method: 'password', ctx });

    const appOrigin = (this.config.get<string>('FRONTEND_ORIGIN') || 'http://localhost:3000').split(',')[0].trim();
    const notice = passwordChangedEmail({ name: user.name, appOrigin });
    this.email
      .send(user.email, notice.subject, notice.html, notice.text)
      .catch((err) => this.logger.error(`Password changed email to ${user.id} failed: ${(err as Error).message}`));

    return this.auth.buildSession(user);
  }
}
