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
exports.AuditService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const llm_service_1 = require("../llm/llm.service");
const quota_service_1 = require("../quota/quota.service");
const pipeline_service_1 = require("./pipeline.service");
const language_1 = require("../common/language");
const workspace_scope_1 = require("../common/workspace-scope");
let AuditService = class AuditService {
    prisma;
    llm;
    quota;
    pipeline;
    constructor(prisma, llm, quota, pipeline) {
        this.prisma = prisma;
        this.llm = llm;
        this.quota = quota;
        this.pipeline = pipeline;
    }
    async runAudit(actor, dto) {
        const filename = dto.filename?.trim() || 'untitled';
        const language = (0, language_1.detectLanguage)(filename);
        const providerName = this.llm.resolveProvider(dto.provider);
        const { result, fromCache } = await this.pipeline.run({ filename, language, code: dto.code, provider: providerName, focusAreas: dto.focusAreas }, { beforeAiCall: () => this.quota.assertCanRunAudit(actor.id) });
        const data = {
            userId: actor.id,
            organizationId: actor.organizationId,
            filename,
            language,
            provider: providerName,
            verdict: result.verdict,
            summary: result.summary,
            findings: result.findings,
            stage1: result.stage1,
            aiInvoked: result.aiInvoked,
            fromCache,
            codeSize: dto.code.length,
        };
        const consumesQuota = !fromCache && result.aiInvoked;
        if (!consumesQuota) {
            return this.prisma.audit.create({ data });
        }
        return this.quota.withQuotaCheck((db) => this.quota.assertCanRunAudit(actor.id, db), (db) => db.audit.create({ data }));
    }
    async findOne(actor, id) {
        const audit = await this.prisma.audit.findUnique({ where: { id } });
        if (!audit || !(0, workspace_scope_1.canViewResource)(actor, audit))
            throw new common_1.NotFoundException(`Audit ${id} not found`);
        return audit;
    }
    async findRecent(actor, limit = 20) {
        return this.prisma.audit.findMany({
            where: (0, workspace_scope_1.workspaceWhere)(actor),
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    }
};
exports.AuditService = AuditService;
exports.AuditService = AuditService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        llm_service_1.LlmService,
        quota_service_1.QuotaService,
        pipeline_service_1.PipelineService])
], AuditService);
//# sourceMappingURL=audit.service.js.map