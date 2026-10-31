import { SubscriptionService } from '../revenue/subscription.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { assertNotOwnerOfOthers, deleteUserRecords } from './delete-user';
import { generateApiKey } from '../auth/api-key.util';
import { EmailService } from '../email/email.service';
import { planRequestTeamEmail } from '../email/templates';
import { teamInbox } from '../common/team-inbox';
import { ActivityService } from '../activity/activity.service';
import { RequestContext } from '../activity/request-context';

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
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly activity: ActivityService,
  ) {}

  /**
   * Logs the request and tells the team inbox — paid plans are paid off-site
   * (Wise link in PlanPanel), so someone has to match it to the payment. The
   * request is already saved, so a mail failure is logged, never surfaced.
   * Awaited by the caller because Cloud Run throttles CPU once the response
   * is sent.
   */
  private async notifyPlanRequest(
    user: { id: string; email: string; name: string | null },
    request: { id: string; createdAt: Date; requestedPlan: { name: string; priceMonthlyCents: number }; organization: { name: string } | null },
    ctx: RequestContext,
  ) {
    await this.activity.log({
      type: 'plan_requested',
      userId: user.id,
      email: user.email,
      ctx,
      metadata: {
        plan: request.requestedPlan.name,
        priceMonthlyCents: request.requestedPlan.priceMonthlyCents,
        organization: request.organization?.name ?? null,
        requestId: request.id,
      },
    });
    const inbox = teamInbox(this.config);
    const origin = (this.config.get<string>('FRONTEND_ORIGIN') || 'http://localhost:3000').split(',')[0].trim();
    const message = planRequestTeamEmail({
      requesterName: user.name,
      requesterEmail: user.email,
      planName: request.requestedPlan.name,
      priceMonthlyCents: request.requestedPlan.priceMonthlyCents,
      organizationName: request.organization?.name ?? null,
      requestId: request.id,
      requestedAt: request.createdAt,
      adminUrl: `${origin}/app/admin`,
    });
    const replyTo = user.name ? `${user.name.replace(/["<>]/g, '')} <${user.email}>` : user.email;
    await this.email
      .send(inbox, message.subject, message.html, message.text, undefined, replyTo)
      .catch((err: Error) => this.logger.error(`Plan request email for ${request.id} failed: ${err.message}`));
  }

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
  async changePlan(userId: string, slug: string, ctx: RequestContext) {
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
        await this.prisma.organization.update({
          where: { id: org.id },
          data: { planId: plan.id, planExpiresAt: null },
        });
        await this.subscriptions.startTerm({ organizationId: org.id }, plan, {
          source: 'self_service',
          actorId: userId,
        });
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
      await this.notifyPlanRequest(user, orgRequest, ctx);
      return { applied: false as const, request: orgRequest };
    }

    if (user.planId === plan.id) {
      throw new ConflictException(`You're already on the ${plan.name} plan`);
    }

    if (isSelfServicePlan(plan)) {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: { planId: plan.id, planExpiresAt: null },
        select: SAFE_USER_SELECT,
      });
      // Switching to Free ends any paid term in the revenue ledger.
      await this.subscriptions.startTerm({ userId }, plan, { source: 'self_service', actorId: userId });
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
    await this.notifyPlanRequest(user, request, ctx);
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

  /**
   * Deletes the account and everything tied to it: scans and their reports,
   * audits, review rules, feedback, connected tokens and GitHub App links.
   * Payment records are kept for accounting, without the user. Confirmed by
   * typing the account's email.
   */
  async deleteAccount(userId: string, confirmEmail: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
      throw new BadRequestException('Type your account email exactly to confirm.');
    }
    if (user.role === 'super_admin') {
      throw new ForbiddenException("A super admin account can't be deleted here, so the site always keeps an admin.");
    }
    await assertNotOwnerOfOthers(
      this.prisma,
      user,
      'You own a team with other members. Remove them or hand over ownership first.',
    );
    await deleteUserRecords(this.prisma, user);
    return { deleted: true };
  }
}
