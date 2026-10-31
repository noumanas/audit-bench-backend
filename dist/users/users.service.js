"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var UsersService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const subscription_service_1 = require("../revenue/subscription.service");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const crypto = require("crypto");
const prisma_service_1 = require("../prisma/prisma.service");
const delete_user_1 = require("./delete-user");
const api_key_util_1 = require("../auth/api-key.util");
const email_service_1 = require("../email/email.service");
const templates_1 = require("../email/templates");
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
};
const PLAN_REQUEST_INCLUDE = {
    requestedPlan: true,
    organization: { select: { id: true, name: true } },
    reviewedBy: { select: { id: true, email: true, name: true } },
};
const DEFAULT_PLAN_REQUEST_INBOX = 'hello@auditbenchai.com';
function isSelfServicePlan(plan) {
    return plan.priceMonthlyCents === 0 && plan.slug !== 'enterprise';
}
let UsersService = UsersService_1 = class UsersService {
    prisma;
    subscriptions;
    email;
    config;
    logger = new common_1.Logger(UsersService_1.name);
    constructor(prisma, subscriptions, email, config) {
        this.prisma = prisma;
        this.subscriptions = subscriptions;
        this.email = email;
        this.config = config;
    }
    async notifyPlanRequest(user, request) {
        const inbox = this.config.get('PLAN_REQUEST_INBOX') || DEFAULT_PLAN_REQUEST_INBOX;
        const origin = (this.config.get('FRONTEND_ORIGIN') || 'http://localhost:3000').split(',')[0].trim();
        const message = (0, templates_1.planRequestTeamEmail)({
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
            .catch((err) => this.logger.error(`Plan request email for ${request.id} failed: ${err.message}`));
    }
    async getProfile(userId) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: SAFE_USER_SELECT,
        });
        if (!user)
            throw new common_1.NotFoundException('User not found');
        return user;
    }
    async changePlan(userId, slug) {
        const plan = await this.prisma.plan.findUnique({ where: { slug } });
        if (!plan)
            throw new common_1.BadRequestException(`Unknown plan "${slug}"`);
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { organization: true } });
        if (user.organizationId) {
            if (user.orgRole !== 'owner' && user.orgRole !== 'admin') {
                throw new common_1.ForbiddenException('Only an organization owner or admin can change the team plan');
            }
            const org = user.organization;
            if (org.planId === plan.id) {
                throw new common_1.ConflictException(`Your organization is already on the ${plan.name} plan`);
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
                return { applied: true, user: updated };
            }
            const pendingOrgRequest = await this.prisma.planRequest.findFirst({
                where: { organizationId: org.id, status: 'pending' },
            });
            if (pendingOrgRequest) {
                throw new common_1.ConflictException('Your organization already has a pending plan request awaiting review');
            }
            const orgRequest = await this.prisma.planRequest.create({
                data: { userId, organizationId: org.id, requestedPlanId: plan.id },
                include: PLAN_REQUEST_INCLUDE,
            });
            await this.notifyPlanRequest(user, orgRequest);
            return { applied: false, request: orgRequest };
        }
        if (user.planId === plan.id) {
            throw new common_1.ConflictException(`You're already on the ${plan.name} plan`);
        }
        if (isSelfServicePlan(plan)) {
            const updated = await this.prisma.user.update({
                where: { id: userId },
                data: { planId: plan.id, planExpiresAt: null },
                select: SAFE_USER_SELECT,
            });
            await this.subscriptions.startTerm({ userId }, plan, { source: 'self_service', actorId: userId });
            return { applied: true, user: updated };
        }
        const pending = await this.prisma.planRequest.findFirst({
            where: { userId, status: 'pending' },
        });
        if (pending) {
            throw new common_1.ConflictException('You already have a pending plan request awaiting review');
        }
        const request = await this.prisma.planRequest.create({
            data: { userId, requestedPlanId: plan.id },
            include: PLAN_REQUEST_INCLUDE,
        });
        await this.notifyPlanRequest(user, request);
        return { applied: false, request };
    }
    async listMyPlanRequests(userId) {
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
        return this.prisma.planRequest.findMany({
            where: user.organizationId ? { organizationId: user.organizationId } : { userId },
            include: PLAN_REQUEST_INCLUDE,
            orderBy: { createdAt: 'desc' },
        });
    }
    async getBadgeToken(userId) {
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
        if (user.badgeToken)
            return user.badgeToken;
        return this.rotateBadgeToken(userId);
    }
    async rotateBadgeToken(userId) {
        const badgeToken = crypto.randomBytes(24).toString('hex');
        await this.prisma.user.update({ where: { id: userId }, data: { badgeToken } });
        return badgeToken;
    }
    async getApiKey(userId) {
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
        if (user.apiKey)
            return user.apiKey;
        return this.rotateApiKey(userId);
    }
    async rotateApiKey(userId) {
        const apiKey = (0, api_key_util_1.generateApiKey)();
        await this.prisma.user.update({ where: { id: userId }, data: { apiKey } });
        return apiKey;
    }
    async deleteAccount(userId, confirmEmail) {
        const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
        if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
            throw new common_1.BadRequestException('Type your account email exactly to confirm.');
        }
        if (user.role === 'super_admin') {
            throw new common_1.ForbiddenException("A super admin account can't be deleted here, so the site always keeps an admin.");
        }
        await (0, delete_user_1.assertNotOwnerOfOthers)(this.prisma, user, 'You own a team with other members. Remove them or hand over ownership first.');
        await (0, delete_user_1.deleteUserRecords)(this.prisma, user);
        return { deleted: true };
    }
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = UsersService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        subscription_service_1.SubscriptionService,
        email_service_1.EmailService,
        config_1.ConfigService])
], UsersService);
//# sourceMappingURL=users.service.js.map