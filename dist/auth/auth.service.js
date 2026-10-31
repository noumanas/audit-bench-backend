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
exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const email_domain_1 = require("./email-domain");
const jwt_1 = require("@nestjs/jwt");
const bcrypt = require("bcryptjs");
const prisma_service_1 = require("../prisma/prisma.service");
const welcome_email_service_1 = require("../email/welcome-email.service");
const activity_service_1 = require("../activity/activity.service");
const SALT_ROUNDS = 12;
const DEFAULT_PLAN_SLUG = "free";
let AuthService = class AuthService {
    prisma;
    jwt;
    config;
    welcomeEmail;
    activity;
    constructor(prisma, jwt, config, welcomeEmail, activity) {
        this.prisma = prisma;
        this.jwt = jwt;
        this.config = config;
        this.welcomeEmail = welcomeEmail;
        this.activity = activity;
    }
    async signup(dto, ctx) {
        const unusable = await (0, email_domain_1.unusableEmailReason)(dto.email);
        if (unusable)
            throw new common_1.BadRequestException(unusable);
        const existing = await this.prisma.user.findUnique({
            where: { email: dto.email },
        });
        if (existing)
            throw new common_1.ConflictException("An account with this email already exists");
        const plan = await this.prisma.plan.findUnique({
            where: { slug: DEFAULT_PLAN_SLUG },
        });
        if (!plan)
            throw new Error(`Default plan "${DEFAULT_PLAN_SLUG}" is not seeded`);
        const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
        const role = "user";
        const user = await this.prisma.user.create({
            data: {
                email: dto.email,
                passwordHash,
                name: dto.name,
                planId: plan.id,
                role,
            },
            include: { plan: true, organization: true },
        });
        this.welcomeEmail.send(user);
        await this.activity.recordSignup(user, "password", ctx, dto.attribution);
        return this.buildSession(user);
    }
    async login(dto, ctx) {
        const failed = (reason, userId) => this.activity.log({
            type: "login_failed",
            userId,
            email: dto.email,
            method: "password",
            ctx,
            metadata: { reason },
        });
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
            include: { plan: true, organization: true },
        });
        if (!user) {
            await failed("unknown_email");
            throw new common_1.UnauthorizedException("Invalid email or password");
        }
        if (!user.passwordHash) {
            await failed("oauth_only_account", user.id);
            throw new common_1.UnauthorizedException("This account uses Google/GitHub/GitLab login — sign in that way instead of with a password.");
        }
        const valid = await bcrypt.compare(dto.password, user.passwordHash);
        if (!valid) {
            await failed("wrong_password", user.id);
            throw new common_1.UnauthorizedException("Invalid email or password");
        }
        if (!user.isActive)
            await failed("suspended", user.id);
        if (bcrypt.getRounds(user.passwordHash) < SALT_ROUNDS) {
            const upgradedHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
            await this.prisma.user.update({
                where: { id: user.id },
                data: { passwordHash: upgradedHash },
            });
        }
        const session = this.buildSession(user);
        await this.activity.log({ type: "login", userId: user.id, email: user.email, method: "password", ctx });
        return session;
    }
    buildSession(user) {
        if (!user.isActive) {
            throw new common_1.UnauthorizedException("This account has been suspended. Contact an administrator.");
        }
        this.prisma.user
            .update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
            .catch(() => { });
        const payload = { sub: user.id, email: user.email };
        return {
            accessToken: this.jwt.sign(payload),
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                createdAt: user.createdAt,
                plan: user.plan,
                role: user.role,
                organization: user.organization
                    ? {
                        id: user.organization.id,
                        name: user.organization.name,
                        slug: user.organization.slug,
                    }
                    : null,
                orgRole: user.organization ? user.orgRole : null,
            },
        };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService,
        config_1.ConfigService,
        welcome_email_service_1.WelcomeEmailService,
        activity_service_1.ActivityService])
], AuthService);
//# sourceMappingURL=auth.service.js.map