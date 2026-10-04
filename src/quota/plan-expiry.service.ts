import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Switches accounts whose paid plan has run past `planExpiresAt` back to
 * Free. QuotaService already treats an expired plan as Free on every check,
 * so this only makes the stored plan (and what the UI shows) catch up.
 */
@Injectable()
export class PlanExpiryService {
  private readonly logger = new Logger(PlanExpiryService.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_10_MINUTES)
  async downgradeExpiredPlans(now = new Date()): Promise<{ users: number; organizations: number }> {
    const free = await this.prisma.plan.findUnique({ where: { slug: 'free' } });
    if (!free) return { users: 0, organizations: 0 };

    const expired = { planExpiresAt: { lte: now }, planId: { not: free.id } };
    const [users, organizations] = await this.prisma.$transaction([
      this.prisma.user.updateMany({ where: expired, data: { planId: free.id, planExpiresAt: null } }),
      this.prisma.organization.updateMany({ where: expired, data: { planId: free.id, planExpiresAt: null } }),
    ]);
    if (users.count || organizations.count) {
      this.logger.log(`Plan expiry: moved ${users.count} user(s) and ${organizations.count} organization(s) to Free`);
    }
    return { users: users.count, organizations: organizations.count };
  }
}
