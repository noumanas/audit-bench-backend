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
exports.AuditCacheService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const prisma_service_1 = require("../prisma/prisma.service");
let AuditCacheService = class AuditCacheService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    hashFor(content, provider, focusAreas = [], changedRanges) {
        const rangesPart = changedRanges ? changedRanges.map((r) => `${r.start}-${r.end}`).join(',') : '';
        const normalized = `${content} ${provider} ${[...focusAreas].sort().join(',')} ${rangesPart}`;
        return (0, crypto_1.createHash)('sha256').update(normalized).digest('hex');
    }
    async exists(contentHash) {
        const hit = await this.prisma.auditCache.findUnique({ where: { contentHash }, select: { contentHash: true } });
        return hit !== null;
    }
    async lookup(contentHash) {
        const hit = await this.prisma.auditCache.findUnique({ where: { contentHash } });
        if (!hit)
            return null;
        await this.prisma.auditCache.update({
            where: { contentHash },
            data: { hitCount: { increment: 1 }, lastHitAt: new Date() },
        });
        return {
            verdict: hit.verdict,
            summary: hit.summary,
            findings: hit.findings,
            stage1: hit.stage1 ?? null,
            aiInvoked: hit.aiInvoked,
        };
    }
    async store(contentHash, result) {
        await this.prisma.auditCache.upsert({
            where: { contentHash },
            create: {
                contentHash,
                verdict: result.verdict,
                summary: result.summary,
                findings: result.findings,
                stage1: result.stage1,
                aiInvoked: result.aiInvoked,
            },
            update: {
                verdict: result.verdict,
                summary: result.summary,
                findings: result.findings,
                stage1: result.stage1,
                aiInvoked: result.aiInvoked,
            },
        });
    }
};
exports.AuditCacheService = AuditCacheService;
exports.AuditCacheService = AuditCacheService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AuditCacheService);
//# sourceMappingURL=cache.service.js.map