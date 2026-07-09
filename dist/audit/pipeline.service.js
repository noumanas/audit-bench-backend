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
var PipelineService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineService = void 0;
const common_1 = require("@nestjs/common");
const llm_service_1 = require("../llm/llm.service");
const cache_service_1 = require("./cache.service");
const finding_schema_1 = require("../common/finding.schema");
const verdict_1 = require("../common/verdict");
const run_stage1_1 = require("./stage1/run-stage1");
const to_findings_1 = require("./stage1/to-findings");
const filter_to_ranges_1 = require("./stage1/filter-to-ranges");
const focused_prompt_1 = require("./stage2/focused-prompt");
const LOW_CONFIDENCE_THRESHOLD = 0.6;
let PipelineService = PipelineService_1 = class PipelineService {
    llm;
    cache;
    logger = new common_1.Logger(PipelineService_1.name);
    constructor(llm, cache) {
        this.llm = llm;
        this.cache = cache;
    }
    async run(input, opts = {}) {
        const hash = this.cache.hashFor(input.code, input.provider, input.focusAreas, input.changedLineRanges);
        const cached = await this.cache.lookup(hash);
        if (cached) {
            return { result: cached, fromCache: true };
        }
        const fullStage1 = await (0, run_stage1_1.runStage1)(input.code, input.filename);
        const stage1 = input.changedLineRanges
            ? (0, filter_to_ranges_1.filterStage1ToRanges)(fullStage1, input.changedLineRanges)
            : fullStage1;
        const baseFindings = (0, to_findings_1.stage1ToFindings)(stage1);
        let result;
        if (stage1.clean) {
            result = {
                verdict: (0, verdict_1.verdictForSeverities)(baseFindings),
                summary: baseFindings.length > 0
                    ? `Local checks (ESLint, TypeScript, complexity, formatting) found ${baseFindings.length} minor issue(s). Nothing here warranted an AI review, so no AI credits were used.`
                    : 'Local checks (ESLint, TypeScript, complexity, formatting) found nothing. No AI credits were used.',
                findings: baseFindings,
                stage1,
                aiInvoked: false,
            };
        }
        else {
            await opts.beforeAiCall?.();
            const prompt = (0, focused_prompt_1.buildFocusedPrompt)({
                filename: input.filename,
                language: input.language,
                riskyFunctions: stage1.riskyFunctions,
                allFunctions: stage1.functions,
                repoContext: input.repoContext,
                focusAreas: input.focusAreas,
            });
            let aiResult = await this.llm.completeStructured(input.provider, prompt, finding_schema_1.auditResultSchema);
            const needsEscalation = this.llm.hasEscalationModel(input.provider) &&
                aiResult.findings.some((f) => f.confidence < LOW_CONFIDENCE_THRESHOLD && (f.severity === 'critical' || f.severity === 'high'));
            if (needsEscalation) {
                try {
                    aiResult = await this.llm.completeStructured(input.provider, prompt, finding_schema_1.auditResultSchema, {
                        escalate: true,
                    });
                }
                catch (err) {
                    this.logger.warn(`Escalation pass failed, keeping first-pass result: ${err.message}`);
                }
            }
            const findings = [...baseFindings, ...aiResult.findings];
            result = {
                verdict: (0, verdict_1.worstVerdict)([aiResult.verdict, (0, verdict_1.verdictForSeverities)(baseFindings)]),
                summary: aiResult.summary,
                findings,
                stage1,
                aiInvoked: true,
            };
        }
        await this.cache.store(hash, result);
        return { result, fromCache: false };
    }
};
exports.PipelineService = PipelineService;
exports.PipelineService = PipelineService = PipelineService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [llm_service_1.LlmService,
        cache_service_1.AuditCacheService])
], PipelineService);
//# sourceMappingURL=pipeline.service.js.map