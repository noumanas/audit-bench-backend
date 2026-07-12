import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';

const DEFAULT_PLAN_SLUG = 'free';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const MEMBER_SELECT = {
  id: true,
  email: true,
  name: true,
  orgRole: true,
  createdAt: true,
} as const;

@Injectable()
export class OrganizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  private frontendOrigin(): string {
    return (this.config.get<string>('FRONTEND_ORIGIN') || 'http://localhost:3000').split(',')[0].trim();
  }

  private inviteUrl(token: string): string {
    return `${this.frontendOrigin()}/invite/${token}`;
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'team';
    for (let i = 0; i < 5; i++) {
      const candidate = i === 0 ? base : `${base}-${crypto.randomBytes(3).toString('hex')}`;
      const existing = await this.prisma.organization.findUnique({ where: { slug: candidate } });
      if (!existing) return candidate;
    }
    return `${base}-${crypto.randomBytes(4).toString('hex')}`;
  }

  async create(userId: string, name: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.organizationId) {
      throw new ConflictException('Leave your current organization before creating a new one');
    }

    const trimmed = name.trim();
    if (!trimmed) throw new BadRequestException('Organization name is required');

    const plan = await this.prisma.plan.findUniqueOrThrow({ where: { slug: DEFAULT_PLAN_SLUG } });
    const slug = await this.generateUniqueSlug(trimmed);

    return this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: trimmed, slug, planId: plan.id } });
      await tx.user.update({ where: { id: userId }, data: { organizationId: org.id, orgRole: 'owner' } });
      return tx.organization.findUniqueOrThrow({ where: { id: org.id }, include: { plan: true } });
    });
  }

  async getForUser(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.organizationId) return null;

    const [org, members, invites] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({ where: { id: user.organizationId }, include: { plan: true } }),
      this.prisma.user.findMany({
        where: { organizationId: user.organizationId },
        select: MEMBER_SELECT,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.organizationInvite.findMany({
        where: { organizationId: user.organizationId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      plan: org.plan,
      myRole: user.orgRole,
      members,
      invites: invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.role,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        inviteUrl: this.inviteUrl(i.token),
      })),
    };
  }

  async createInvite(actingUserId: string, dto: { email: string; role: OrgRole }) {
    const actor = await this.prisma.user.findUniqueOrThrow({
      where: { id: actingUserId },
      include: { organization: true },
    });
    if (!actor.organizationId || !actor.organization) {
      throw new ForbiddenException('You are not part of an organization');
    }
    if (actor.orgRole !== 'owner' && actor.orgRole !== 'admin') {
      throw new ForbiddenException('Only an owner or admin can invite teammates');
    }

    const email = dto.email.trim().toLowerCase();
    if (email === actor.email.toLowerCase()) {
      throw new ConflictException("You can't invite yourself");
    }

    const existingMember = await this.prisma.user.findFirst({
      where: { email, organizationId: actor.organizationId },
    });
    if (existingMember) throw new ConflictException('This person is already a member of your organization');

    const pendingInvite = await this.prisma.organizationInvite.findFirst({
      where: { organizationId: actor.organizationId, email, status: 'pending' },
    });
    if (pendingInvite) throw new ConflictException('There is already a pending invite for this email');

    const token = crypto.randomBytes(24).toString('hex');
    const invite = await this.prisma.organizationInvite.create({
      data: {
        organizationId: actor.organizationId,
        email,
        role: dto.role,
        token,
        invitedById: actingUserId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });

    const url = this.inviteUrl(token);
    const inviterName = actor.name || actor.email;
    await this.email.send(
      email,
      `You've been invited to join ${actor.organization.name} on audit/bench`,
      `<p>${inviterName} invited you to join <strong>${actor.organization.name}</strong> on audit/bench.</p><p><a href="${url}">Accept invite</a></p><p>This link expires in 7 days.</p>`,
      `${inviterName} invited you to join ${actor.organization.name} on audit/bench.\n\nAccept: ${url}\n\nThis link expires in 7 days.`,
    );

    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      inviteUrl: url,
      emailSent: this.email.isConfigured,
    };
  }

  async revokeInvite(actingUserId: string, inviteId: string) {
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
    if (!actor.organizationId) throw new ForbiddenException('You are not part of an organization');
    if (actor.orgRole !== 'owner' && actor.orgRole !== 'admin') {
      throw new ForbiddenException('Only an owner or admin can revoke invites');
    }

    const invite = await this.prisma.organizationInvite.findUnique({ where: { id: inviteId } });
    if (!invite || invite.organizationId !== actor.organizationId) {
      throw new NotFoundException('Invite not found');
    }
    if (invite.status !== 'pending') throw new ConflictException('This invite is no longer pending');

    return this.prisma.organizationInvite.update({ where: { id: inviteId }, data: { status: 'revoked' } });
  }

  /** Public — no auth. Lets the /invite/:token page render before the visitor logs in or signs up. */
  async getInvitePreview(token: string) {
    const invite = await this.prisma.organizationInvite.findUnique({
      where: { token },
      include: {
        organization: { select: { name: true } },
        invitedBy: { select: { name: true, email: true } },
      },
    });
    if (!invite) throw new NotFoundException('Invite not found');

    const status = invite.status === 'pending' && invite.expiresAt.getTime() < Date.now() ? 'expired' : invite.status;

    return {
      organizationName: invite.organization.name,
      email: invite.email,
      role: invite.role,
      invitedBy: invite.invitedBy.name || invite.invitedBy.email,
      status,
      expiresAt: invite.expiresAt,
    };
  }

  async acceptInvite(userId: string, token: string) {
    const invite = await this.prisma.organizationInvite.findUnique({ where: { token } });
    if (!invite) throw new NotFoundException('Invite not found');
    if (invite.status !== 'pending') throw new BadRequestException('This invite is no longer valid');
    if (invite.expiresAt.getTime() < Date.now()) {
      await this.prisma.organizationInvite.update({ where: { id: invite.id }, data: { status: 'expired' } });
      throw new BadRequestException('This invite has expired — ask for a new one');
    }

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
      throw new ForbiddenException(
        'This invite was sent to a different email address — log in with that account to accept it.',
      );
    }
    if (user.organizationId) {
      throw new ConflictException('Leave your current organization before accepting a new invite');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { organizationId: invite.organizationId, orgRole: invite.role },
      });
      await tx.organizationInvite.update({
        where: { id: invite.id },
        data: { status: 'accepted', acceptedAt: new Date() },
      });
      return tx.organization.findUniqueOrThrow({ where: { id: invite.organizationId }, include: { plan: true } });
    });
  }

  /** Ownership transfer isn't supported in this version — only owner can promote/demote, and never to/from 'owner'. */
  async updateMemberRole(actingUserId: string, targetUserId: string, role: OrgRole) {
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
    if (!actor.organizationId) throw new ForbiddenException('You are not part of an organization');
    if (actor.orgRole !== 'owner') throw new ForbiddenException('Only the organization owner can change member roles');
    if (actingUserId === targetUserId) throw new ForbiddenException("You can't change your own role");

    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target || target.organizationId !== actor.organizationId) throw new NotFoundException('Member not found');
    if (target.orgRole === 'owner') throw new ForbiddenException("The owner's role can't be changed");

    return this.prisma.user.update({
      where: { id: targetUserId },
      data: { orgRole: role },
      select: MEMBER_SELECT,
    });
  }

  async removeMember(actingUserId: string, targetUserId: string) {
    const actor = await this.prisma.user.findUniqueOrThrow({ where: { id: actingUserId } });
    if (!actor.organizationId) throw new ForbiddenException('You are not part of an organization');
    if (actor.orgRole !== 'owner' && actor.orgRole !== 'admin') {
      throw new ForbiddenException('Only an owner or admin can remove teammates');
    }
    if (actingUserId === targetUserId) {
      throw new ForbiddenException('Use "Leave organization" to remove yourself');
    }

    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target || target.organizationId !== actor.organizationId) {
      throw new NotFoundException('Member not found');
    }
    if (target.orgRole === 'owner') throw new ForbiddenException('The organization owner cannot be removed');

    return this.prisma.user.update({
      where: { id: targetUserId },
      data: { organizationId: null, orgRole: null },
      select: MEMBER_SELECT,
    });
  }

  async leave(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.organizationId) throw new BadRequestException('You are not part of an organization');

    if (user.orgRole === 'owner') {
      const otherMembers = await this.prisma.user.count({
        where: { organizationId: user.organizationId, id: { not: userId } },
      });
      if (otherMembers > 0) {
        throw new ForbiddenException('Remove the other members before leaving — an organization always needs an owner');
      }
      await this.deleteOrganization(userId);
      return { left: true, organizationDeleted: true };
    }

    await this.prisma.user.update({ where: { id: userId }, data: { organizationId: null, orgRole: null } });
    return { left: true, organizationDeleted: false };
  }

  async deleteOrganization(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.organizationId || user.orgRole !== 'owner') {
      throw new ForbiddenException('Only the owner can delete the organization');
    }

    const otherMembers = await this.prisma.user.count({
      where: { organizationId: user.organizationId, id: { not: userId } },
    });
    if (otherMembers > 0) {
      throw new ConflictException('Remove all other members before deleting the organization');
    }

    const organizationId = user.organizationId;
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { organizationId: null, orgRole: null } }),
      this.prisma.organization.delete({ where: { id: organizationId } }),
    ]);
    return { deleted: true };
  }
}
