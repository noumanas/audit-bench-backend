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
const jwt_1 = require("@nestjs/jwt");
const bcrypt = require("bcryptjs");
const prisma_service_1 = require("../prisma/prisma.service");
const SALT_ROUNDS = 10;
const DEFAULT_PLAN_SLUG = 'free';
let AuthService = class AuthService {
    prisma;
    jwt;
    config;
    constructor(prisma, jwt, config) {
        this.prisma = prisma;
        this.jwt = jwt;
        this.config = config;
    }
    async signup(dto) {
        const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
        if (existing)
            throw new common_1.ConflictException('An account with this email already exists');
        const plan = await this.prisma.plan.findUnique({ where: { slug: DEFAULT_PLAN_SLUG } });
        if (!plan)
            throw new Error(`Default plan "${DEFAULT_PLAN_SLUG}" is not seeded`);
        const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
        const superAdminEmail = this.config.get('SUPER_ADMIN_EMAIL');
        const role = superAdminEmail && superAdminEmail.toLowerCase() === dto.email.toLowerCase() ? 'super_admin' : 'user';
        const user = await this.prisma.user.create({
            data: { email: dto.email, passwordHash, name: dto.name, planId: plan.id, role },
            include: { plan: true },
        });
        return this.buildSession(user);
    }
    async login(dto) {
        const user = await this.prisma.user.findUnique({
            where: { email: dto.email },
            include: { plan: true },
        });
        if (!user)
            throw new common_1.UnauthorizedException('Invalid email or password');
        if (!user.passwordHash) {
            throw new common_1.UnauthorizedException('This account uses GitHub/GitLab login — sign in that way instead of with a password.');
        }
        const valid = await bcrypt.compare(dto.password, user.passwordHash);
        if (!valid)
            throw new common_1.UnauthorizedException('Invalid email or password');
        return this.buildSession(user);
    }
    buildSession(user) {
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
            },
        };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService,
        config_1.ConfigService])
], AuthService);
//# sourceMappingURL=auth.service.js.map