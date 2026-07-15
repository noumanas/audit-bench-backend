import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { generateApiKey } from '../auth/api-key.util';

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
  orgRole: true,
  organization: { select: { id: true, name: true, slug: true } },
} as const;

const PLAN_REQUEST_INCLUDE = {
  requestedPlan: true,
  organization: { select: { id: true, name: true } },
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
   *
   * A user inside an organization is changing the ORG's shared plan, not
   * their own dormant personal one — same self-service/request split, just
   * targeting `organizationId` instead of `userId` (see PlanRequest.organizationId).
   */
  async changePlan(userId: string, slug: string) {
    const plan = await this.prisma.plan.findUnique({ where: { slug } });
    if (!plan) throw new BadRequestException(`Unknown plan "${slug}"`);

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { organization: true } });

    if (user.organizationId) {
      if (user.orgRole !== 'owner' && user.orgRole !== 'admin') {
        throw new ForbiddenException('Only an organization owner or admin can change the team plan');
      }
      const org = user.organization!;
      if (org.planId === plan.id) {
        throw new ConflictException(`Your organization is already on the ${plan.name} plan`);
      }

      if (isSelfServicePlan(plan)) {
        await this.prisma.organization.update({ where: { id: org.id }, data: { planId: plan.id } });
        const updated = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: SAFE_USER_SELECT });
        return { applied: true as const, user: updated };
      }

      const pendingOrgRequest = await this.prisma.planRequest.findFirst({
        where: { organizationId: org.id, status: 'pending' },
      });
      if (pendingOrgRequest) {
        throw new ConflictException('Your organization already has a pending plan request awaiting review');
      }

      const orgRequest = await this.prisma.planRequest.create({
        data: { userId, organizationId: org.id, requestedPlanId: plan.id },
        include: PLAN_REQUEST_INCLUDE,
      });
      return { applied: false as const, request: orgRequest };
    }

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
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return this.prisma.planRequest.findMany({
      where: user.organizationId ? { organizationId: user.organizationId } : { userId },
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

  /**
   * Get-or-create, same shape as the badge token — except the key itself is
   * a real credential (grants full API access as this user, for the
   * CLI/CI), so unlike badgeToken it's deliberately left out of
   * SAFE_USER_SELECT and only ever returned from these two dedicated routes.
   */
  async getApiKey(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.apiKey) return user.apiKey;
    return this.rotateApiKey(userId);
  }

  async rotateApiKey(userId: string): Promise<string> {
    const apiKey = generateApiKey();
    await this.prisma.user.update({ where: { id: userId }, data: { apiKey } });
    return apiKey;
  }
}
