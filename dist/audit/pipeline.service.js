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
const types_1 = require("../common/types");
const verdict_1 = require("../common/verdict");
const types_2 = require("./stage1/types");
const run_stage1_1 = require("./stage1/run-stage1");
const to_findings_1 = require("./stage1/to-findings");
const filter_to_ranges_1 = require("./stage1/filter-to-ranges");
const finding_fingerprint_1 = require("../common/finding-fingerprint");
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
        const hash = this.cache.hashFor(input.code, input.provider, input.focusAreas, input.changedLineRanges, (0, cache_service_1.cacheExtraKey)(input.rulesKey, input.relatedContext));
        const suppressed = new Set(input.suppressFingerprints ?? []);
        const keep = (findings) => suppressed.size ? findings.filter((f) => !suppressed.has((0, finding_fingerprint_1.findingFingerprint)(f))) : findings;
        const cached = await this.cache.lookup(hash);
        if (cached) {
            return { result: cached, fromCache: true, usage: types_1.ZERO_USAGE };
        }
        const fullStage1 = await (0, run_stage1_1.runStage1)(input.code, input.filename);
        const stage1 = input.changedLineRanges ? (0, filter_to_ranges_1.filterStage1ToRanges)(fullStage1, input.changedLineRanges) : fullStage1;
        const baseFindings = keep((0, to_findings_1.stage1ToFindings)(stage1));
        let result;
        let usage = types_1.ZERO_USAGE;
        const diffReview = !input.localOnly && Boolean(input.changedLineRanges?.length);
        if (!stage1.clean && input.localOnly) {
            return {
                result: {
                    verdict: (0, verdict_1.verdictForSeverities)(baseFindings),
                    summary: `Local checks found ${baseFindings.length} issue(s) and flagged ${stage1.riskyFunctions.length} function(s) that would get an AI review on a full scan.`,
                    findings: baseFindings,
                    stage1: (0, types_2.withoutSourceCode)(stage1),
                    aiInvoked: false,
                },
                fromCache: false,
                usage,
            };
        }
        if (stage1.clean && !diffReview) {
            result = {
                verdict: (0, verdict_1.verdictForSeverities)(baseFindings),
                summary: baseFindings.length > 0
                    ? `Local checks (JavaScript/TypeScript, Python, complexity, formatting) found ${baseFindings.length} minor issue(s). Nothing here warranted an AI review, so no AI credits were used.`
                    : 'Local checks (JavaScript/TypeScript, Python, complexity, formatting) found nothing. No AI credits were used.',
                findings: baseFindings,
                stage1,
                aiInvoked: false,
            };
        }
        else {
            await opts.beforeAiCall?.();
            const prompt = diffReview
                ? (0, focused_prompt_1.buildDiffPrompt)({
                    filename: input.filename,
                    language: input.language,
                    code: input.code,
                    changedRanges: input.changedLineRanges,
                    relatedContext: input.relatedContext,
                    repoContext: input.repoContext,
                    focusAreas: input.focusAreas,
                    teamRules: input.teamRules,
                })
                : (0, focused_prompt_1.buildFocusedPrompt)({
                    filename: input.filename,
                    language: input.language,
                    riskyFunctions: stage1.riskyFunctions,
                    allFunctions: stage1.functions,
                    repoContext: input.repoContext,
                    focusAreas: input.focusAreas,
                    teamRules: input.teamRules,
                });
            const first = await this.llm.completeStructured(input.provider, prompt, finding_schema_1.auditResultSchema);
            let aiResult = first.result;
            usage = (0, types_1.addUsage)(usage, first.usage);
            const needsEscalation = this.llm.hasEscalationModel(input.provider) &&
                aiResult.findings.some((f) => f.confidence < LOW_CONFIDENCE_THRESHOLD && (f.severity === 'critical' || f.severity === 'high'));
            if (needsEscalation) {
                try {
                    const escalated = await this.llm.completeStructured(input.provider, prompt, finding_schema_1.auditResultSchema, {
                        escalate: true,
                    });
                    aiResult = escalated.result;
                    usage = (0, types_1.addUsage)(usage, escalated.usage);
                }
                catch (err) {
                    this.logger.warn(`Escalation pass failed, keeping first-pass result: ${err.message}`);
                }
            }
            const aiFindings = keep(aiResult.findings);
            const findings = [...baseFindings, ...aiFindings];
            result = {
                verdict: (0, verdict_1.worstVerdict)([
                    aiFindings.length === aiResult.findings.length ? aiResult.verdict : (0, verdict_1.verdictForSeverities)(aiFindings),
                    (0, verdict_1.verdictForSeverities)(baseFindings),
                ]),
                summary: aiResult.summary,
                findings,
                stage1,
                aiInvoked: true,
            };
        }
        result = { ...result, stage1: result.stage1 ? (0, types_2.withoutSourceCode)(result.stage1) : result.stage1 };
        await this.cache.store(hash, result);
        return { result, fromCache: false, usage };
    }
};
exports.PipelineService = PipelineService;
exports.PipelineService = PipelineService = PipelineService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [llm_service_1.LlmService,
        cache_service_1.AuditCacheService])
], PipelineService);
//# sourceMappingURL=pipeline.service.js.map