import { SubscriptionService } from '../revenue/subscription.service';
import { planExpiryFor } from '../common/plan-expiry';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { assertNotOwnerOfOthers, deleteUserRecords } from '../users/delete-user';
import { SYSTEM_EMAIL } from '../common/system-account';
import { EmailService } from '../email/email.service';
import { ActivityService } from '../activity/activity.service';
import { planApprovedEmail, planRejectedEmail, RenderedEmail } from '../email/templates';
import { PlanRequestStatus, Role } from '@prisma/client';

const SAFE_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
  lastLoginAt: true,
  plan: true,
  planExpiresAt: true,
  role: true,
  githubUsername: true,
  isActive: true,
  // Real counts via a Prisma relation aggregate, not a separate query per
  // user — cheap enough to include on every mutation response too, so the
  // admin table's row never loses these after an edit/role/status change.
  _count: { select: { audits: true, scanJobs: true } },
} as const;

const PLAN_REQUEST_INCLUDE = {
  user: { select: { id: true, email: true, name: true } },
  organization: { select: { id: true, name: true } },
  requestedPlan: true,
  reviewedBy: { select: { id: true, email: true, name: true } },
} as const;

const VALID_STATUSES: PlanRequestStatus[] = ['pending', 'approved', 'rejected'];

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
    private readonly activity: ActivityService,
  ) {}

  private async reviewerEmail(adminId: string): Promise<string | null> {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId }, select: { email: true } });
    return admin?.email ?? null;
  }

  private appUrl(path: string): string {
    return `${(this.config.get<string>('FRONTEND_ORIGIN') || 'http://localhost:3000').split(',')[0].trim()}${path}`;
  }

  // The decision is already committed by the time this runs — a mail
  // failure is logged, never surfaced as a failed approve/reject.
  private notifyRequester(to: string, message: RenderedEmail) {
    this.email
      .send(to, message.subject, message.html, message.text)
      .catch((err: Error) => this.logger.error(`Plan request email to ${to} failed: ${err.message}`));
  }

  async listUsers() {
    return this.prisma.user.findMany({ select: SAFE_USER_SELECT, orderBy: { createdAt: 'desc' } });
  }

  async listPlanRequests(status?: string) {
    if (status && !VALID_STATUSES.includes(status as PlanRequestStatus)) {
      throw new BadRequestException(`Unknown status "${status}"`);
    }
    return this.prisma.planRequest.findMany({
      where: status ? { status: status as PlanRequestStatus } : undefined,
      include: PLAN_REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async approvePlanRequest(adminId: string, requestId: string) {
    const request = await this.prisma.planRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Plan request not found');
    if (request.status !== 'pending') {
      throw new ConflictException('This request has already been reviewed');
    }

    // Org-targeted request (see PlanRequest.organizationId) updates the
    // organization's shared plan; otherwise this is the requester's own.
    // Approval starts a fresh 30-day term (approving again renews it).
    const requestedPlan = await this.prisma.plan.findUniqueOrThrow({ where: { id: request.requestedPlanId } });
    const planData = { planId: requestedPlan.id, planExpiresAt: planExpiryFor(requestedPlan) };
    const planUpdate = request.organizationId
      ? this.prisma.organization.update({ where: { id: request.organizationId }, data: planData })
      : this.prisma.user.update({ where: { id: request.userId }, data: planData });

    const [, updatedRequest] = await this.prisma.$transaction([
      planUpdate,
      this.prisma.planRequest.update({
        where: { id: requestId },
        data: { status: 'approved', reviewedById: adminId, reviewedAt: new Date() },
        include: PLAN_REQUEST_INCLUDE,
      }),
    ]);
    // Revenue ledger: close the old term, open the new one.
    await this.subscriptions.startTerm(
      request.organizationId ? { organizationId: request.organizationId } : { userId: request.userId },
      requestedPlan,
      { source: 'approval', actorId: adminId },
    );
    this.notifyRequester(
      updatedRequest.user.email,
      planApprovedEmail({
        name: updatedRequest.user.name,
        planName: requestedPlan.name,
        appUrl: this.appUrl('/app'),
        expiresAt: planData.planExpiresAt,
      }),
    );
    await this.activity.log({
      type: 'plan_approved',
      userId: request.userId,
      email: updatedRequest.user.email,
      metadata: { plan: requestedPlan.name, requestId, reviewedBy: await this.reviewerEmail(adminId) },
    });
    return updatedRequest;
  }

  async rejectPlanRequest(adminId: string, requestId: string, note?: string) {
    const request = await this.prisma.planRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Plan request not found');
    if (request.status !== 'pending') {
      throw new ConflictException('This request has already been reviewed');
    }

    const updatedRequest = await this.prisma.planRequest.update({
      where: { id: requestId },
      data: { status: 'rejected', reviewedById: adminId, reviewedAt: new Date(), note },
      include: PLAN_REQUEST_INCLUDE,
    });
    this.notifyRequester(
      updatedRequest.user.email,
      planRejectedEmail({
        name: updatedRequest.user.name,
        planName: updatedRequest.requestedPlan.name,
        appUrl: this.appUrl('/pricing'),
        note,
      }),
    );
    await this.activity.log({
      type: 'plan_rejected',
      userId: request.userId,
      email: updatedRequest.user.email,
      metadata: {
        plan: updatedRequest.requestedPlan.name,
        requestId,
        reviewedBy: await this.reviewerEmail(adminId),
        note: note ?? null,
      },
    });
    return updatedRequest;
  }

  async updateUserRole(actingAdminId: string, targetUserId: string, role: Role) {
    if (actingAdminId === targetUserId) {
      throw new ForbiddenException('You cannot change your own role');
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id: targetUserId },
      data: { role },
      select: SAFE_USER_SELECT,
    });
  }

  async updateUserStatus(actingAdminId: string, targetUserId: string, isActive: boolean) {
    if (actingAdminId === targetUserId) {
      throw new ForbiddenException('You cannot suspend your own account');
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');

    return this.prisma.user.update({
      where: { id: targetUserId },
      data: { isActive },
      select: SAFE_USER_SELECT,
    });
  }

  /**
   * Permanently deletes another user's account and data. Typing their email
   * guards against deleting the wrong row. Super admins are protected (demote
   * first) so the site always keeps one, and so is your own account (use
   * Delete account in Plan & usage).
   */
  async deleteUser(actingAdminId: string, targetUserId: string, confirmEmail: string) {
    if (actingAdminId === targetUserId) {
      throw new ForbiddenException('You can’t delete your own account here. Use Delete account in Plan & usage.');
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, role: true, organizationId: true, orgRole: true },
    });
    if (!target) throw new NotFoundException('User not found');
    if (confirmEmail.trim().toLowerCase() !== target.email.toLowerCase()) {
      throw new BadRequestException('Type the user’s email exactly to confirm.');
    }
    if (target.role === 'super_admin') {
      throw new ForbiddenException('Super admins can’t be deleted. Change their role first.');
    }
    if (target.email.toLowerCase() === SYSTEM_EMAIL) {
      throw new ForbiddenException('This is the built-in account that owns free public scans. It can’t be deleted.');
    }
    await assertNotOwnerOfOthers(
      this.prisma,
      target,
      'This user owns a team with other members. Remove the members or transfer ownership first.',
    );
    await deleteUserRecords(this.prisma, target);
    this.logger.log(`User ${target.email} (${target.id}) deleted by admin ${actingAdminId}`);
    return { deleted: true };
  }

  async updateUserProfile(targetUserId: string, data: { name?: string; planId?: string }, actorId?: string) {
    if (data.name === undefined && data.planId === undefined) {
      throw new BadRequestException('Nothing to update');
    }

    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new NotFoundException('User not found');

    let planExpiresAt: Date | null | undefined;
    let plan: Awaited<ReturnType<typeof this.prisma.plan.findUnique>> = null;
    if (data.planId) {
      plan = await this.prisma.plan.findUnique({ where: { id: data.planId } });
      if (!plan) throw new BadRequestException('Unknown plan');
      // Setting a plan by hand starts (or renews) its 30-day term, same as approving a request.
      planExpiresAt = planExpiryFor(plan);
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { name: data.name, planId: data.planId, planExpiresAt },
      select: SAFE_USER_SELECT,
    });
    if (plan) await this.subscriptions.startTerm({ userId: targetUserId }, plan, { source: 'admin', actorId });
    return updated;
  }
}
