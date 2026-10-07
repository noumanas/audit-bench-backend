import { SubscriptionService } from '../revenue/subscription.service';
import { planExpiryFor } from '../common/plan-expiry';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptions: SubscriptionService,
  ) {}

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
    return updatedRequest;
  }

  async rejectPlanRequest(adminId: string, requestId: string, note?: string) {
    const request = await this.prisma.planRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Plan request not found');
    if (request.status !== 'pending') {
      throw new ConflictException('This request has already been reviewed');
    }

    return this.prisma.planRequest.update({
      where: { id: requestId },
      data: { status: 'rejected', reviewedById: adminId, reviewedAt: new Date(), note },
      include: PLAN_REQUEST_INCLUDE,
    });
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
