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
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const common_1 = require("@nestjs/common");
const crypto = require("crypto");
const prisma_service_1 = require("../prisma/prisma.service");
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
function isSelfServicePlan(plan) {
    return plan.priceMonthlyCents === 0 && plan.slug !== 'enterprise';
}
let UsersService = class UsersService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
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
                await this.prisma.organization.update({ where: { id: org.id }, data: { planId: plan.id } });
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
            return { applied: false, request: orgRequest };
        }
        if (user.planId === plan.id) {
            throw new common_1.ConflictException(`You're already on the ${plan.name} plan`);
        }
        if (isSelfServicePlan(plan)) {
            const updated = await this.prisma.user.update({
                where: { id: userId },
                data: { planId: plan.id },
                select: SAFE_USER_SELECT,
            });
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
};
exports.UsersService = UsersService;
exports.UsersService = UsersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], UsersService);
//# sourceMappingURL=users.service.js.map