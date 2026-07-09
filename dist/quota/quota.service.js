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
exports.QuotaService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const prisma_service_1 = require("../prisma/prisma.service");
function startOfDay(d = new Date()) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function startOfNextDay(d = new Date()) {
    const s = startOfDay(d);
    s.setDate(s.getDate() + 1);
    return s;
}
function startOfMonth(d = new Date()) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfNextMonth(d = new Date()) {
    const s = startOfMonth(d);
    s.setMonth(s.getMonth() + 1);
    return s;
}
let QuotaService = class QuotaService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    loadUserWithPlan(db, userId) {
        return db.user.findUniqueOrThrow({
            where: { id: userId },
            include: { plan: true },
        });
    }
    async countUsage(db, userId, since) {
        const [audits, scans] = await Promise.all([
            db.audit.count({ where: { userId, createdAt: { gte: since }, aiInvoked: true, fromCache: false } }),
            db.scanJob.count({ where: { userId, createdAt: { gte: since }, aiInvoked: true } }),
        ]);
        return audits + scans;
    }
    async getUsage(userId, db = this.prisma) {
        const user = await this.loadUserWithPlan(db, userId);
        const [dailyUsed, monthlyUsed] = await Promise.all([
            this.countUsage(db, userId, startOfDay()),
            this.countUsage(db, userId, startOfMonth()),
        ]);
        return {
            plan: user.plan,
            dailyUsed,
            dailyLimit: user.plan.dailyAuditLimit,
            monthlyUsed,
            monthlyLimit: user.plan.monthlyAuditLimit,
            dailyResetsAt: startOfNextDay(),
            monthlyResetsAt: startOfNextMonth(),
        };
    }
    async assertCanRunAudit(userId, db = this.prisma) {
        const usage = await this.getUsage(userId, db);
        if (usage.dailyLimit != null && usage.dailyUsed >= usage.dailyLimit) {
            throw new common_1.HttpException({
                message: `Daily audit limit reached (${usage.dailyUsed}/${usage.dailyLimit}). Resets at ${usage.dailyResetsAt.toISOString()}.`,
                resetsAt: usage.dailyResetsAt,
                scope: 'daily',
            }, common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
        if (usage.monthlyLimit != null && usage.monthlyUsed >= usage.monthlyLimit) {
            throw new common_1.HttpException({
                message: `Monthly audit limit reached (${usage.monthlyUsed}/${usage.monthlyLimit}). Resets at ${usage.monthlyResetsAt.toISOString()}.`,
                resetsAt: usage.monthlyResetsAt,
                scope: 'monthly',
            }, common_1.HttpStatus.TOO_MANY_REQUESTS);
        }
    }
    async assertPlanAllowsRepositoryScan(userId, db = this.prisma) {
        const user = await this.loadUserWithPlan(db, userId);
        if (!user.plan.repositoryScan) {
            throw new common_1.ForbiddenException(`Repository scanning isn't included in the ${user.plan.name} plan. Upgrade to Pro or higher.`);
        }
    }
    async assertCanScanRepository(userId, db = this.prisma) {
        await this.assertPlanAllowsRepositoryScan(userId, db);
        await this.assertCanRunAudit(userId, db);
    }
    async withQuotaCheck(checker, create, attempt = 0) {
        try {
            return await this.prisma.$transaction(async (tx) => {
                await checker(tx);
                return create(tx);
            }, { isolationLevel: client_1.Prisma.TransactionIsolationLevel.Serializable });
        }
        catch (err) {
            if (err instanceof client_1.Prisma.PrismaClientKnownRequestError && err.code === 'P2034' && attempt < 1) {
                return this.withQuotaCheck(checker, create, attempt + 1);
            }
            throw err;
        }
    }
};
exports.QuotaService = QuotaService;
exports.QuotaService = QuotaService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], QuotaService);
//# sourceMappingURL=quota.service.js.map