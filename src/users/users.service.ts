import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

// Explicit allow-list — never spread a raw User row to a client. That row
// carries passwordHash and plaintext GitHub/GitLab PATs, neither of which
// should ever leave the server.
const SAFE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
  plan: true,
  role: true,
  githubUsername: true,
  badgeToken: true,
} as const;

const PLAN_REQUEST_INCLUDE = {
  requestedPlan: true,
  reviewedBy: { select: { id: true, email: true, name: true } },
} as const;

function isSelfServicePlan(plan: { slug: string; priceMonthlyCents: number }): boolean {
  // Free is the only tier a user can switch into instantly. Everything else
  // needs admin approval — including Enterprise, which is priced at $0 as a
  // placeholder for "contact sales" (see PricingTeaser) rather than being
  // genuinely free.
  return plan.priceMonthlyCents === 0 && plan.slug !== 'enterprise';
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: SAFE_USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /**
   * Free plan changes apply instantly. Any other plan files a PlanRequest
   * instead of touching the user's row directly — an admin/super_admin has
   * to approve it (see AdminService.approvePlanRequest) before it takes
   * effect.
   */
  async changePlan(userId: string, slug: string) {
    const plan = await this.prisma.plan.findUnique({ where: { slug } });
    if (!plan) throw new BadRequestException(`Unknown plan "${slug}"`);

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.planId === plan.id) {
      throw new ConflictException(`You're already on the ${plan.name} plan`);
    }

    if (isSelfServicePlan(plan)) {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: { planId: plan.id },
        select: SAFE_USER_SELECT,
      });
      return { applied: true as const, user: updated };
    }

    const pending = await this.prisma.planRequest.findFirst({
      where: { userId, status: 'pending' },
    });
    if (pending) {
      throw new ConflictException('You already have a pending plan request awaiting review');
    }

    const request = await this.prisma.planRequest.create({
      data: { userId, requestedPlanId: plan.id },
      include: PLAN_REQUEST_INCLUDE,
    });
    return { applied: false as const, request };
  }

  async listMyPlanRequests(userId: string) {
    return this.prisma.planRequest.findMany({
      where: { userId },
      include: PLAN_REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Get-or-create — most users never need to think about rotation, just want a working badge URL. */
  async getBadgeToken(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.badgeToken) return user.badgeToken;
    return this.rotateBadgeToken(userId);
  }

  async rotateBadgeToken(userId: string): Promise<string> {
    const badgeToken = crypto.randomBytes(24).toString('hex');
    await this.prisma.user.update({ where: { id: userId }, data: { badgeToken } });
    return badgeToken;
  }
}
