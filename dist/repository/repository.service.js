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
var RepositoryService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.RepositoryService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const pLimit = require("p-limit");
const review_failure_1 = require("../common/review-failure");
const prisma_service_1 = require("../prisma/prisma.service");
const llm_service_1 = require("../llm/llm.service");
const quota_service_1 = require("../quota/quota.service");
const pipeline_service_1 = require("../audit/pipeline.service");
const cache_service_1 = require("../audit/cache.service");
const run_stage1_1 = require("../audit/stage1/run-stage1");
const filter_to_ranges_1 = require("../audit/stage1/filter-to-ranges");
const language_1 = require("../common/language");
const file_walker_1 = require("../analysis/file-walker");
const framework_detector_1 = require("../analysis/framework-detector");
const dependency_graph_1 = require("../analysis/dependency-graph");
const dead_code_1 = require("../analysis/dead-code");
const duplicate_code_1 = require("../analysis/duplicate-code");
const secrets_scanner_1 = require("../analysis/secrets-scanner");
const generated_files_1 = require("../analysis/generated-files");
const dependency_audit_1 = require("../analysis/dependency-audit");
const license_audit_1 = require("../analysis/license-audit");
const test_coverage_1 = require("../analysis/test-coverage");
const architecture_detector_1 = require("../audit/architecture-detector");
const tdd_assessment_1 = require("./tdd-assessment");
const risk_aggregation_1 = require("./risk-aggregation");
const reconcile_verdict_1 = require("./reconcile-verdict");
const types_1 = require("../common/types");
const verdict_1 = require("../common/verdict");
const pr_feedback_service_1 = require("../pr-feedback/pr-feedback.service");
const merge_readiness_1 = require("../common/merge-readiness");
const finding_fingerprint_1 = require("../common/finding-fingerprint");
const related_context_1 = require("../analysis/related-context");
const review_rules_service_1 = require("../review-rules/review-rules.service");
const pr_insights_1 = require("../pr-feedback/pr-insights");
const inline_comment_1 = require("../pr-feedback/inline-comment");
const finding_schema_1 = require("../common/finding.schema");
const repo_key_1 = require("../common/repo-key");
const workspace_scope_1 = require("../common/workspace-scope");
const RISKY_PATH = /(auth|login|logon|signin|signup|password|passwd|pwd|reset|token|session|oauth|permission|admin|payment|billing|invoice|checkout|discount|credit|refund|wallet|order|connectionstring|connection_string|secret|crypto|controller|function|handler|endpoint|api)/i;
const DATA_FILE = /\.(json|ya?ml|prisma|sql)$/i;
function selectFilesToAnalyze(files, max) {
    const skipped = [];
    const analyzable = files.filter((f) => {
        const ext = f.path.split('.').pop()?.toLowerCase();
        const ok = Boolean(ext && language_1.ANALYZABLE_EXTENSIONS.has(ext));
        if (!ok)
            skipped.push({ path: f.path, reason: 'not_source' });
        return ok;
    });
    const priority = (p) => (DATA_FILE.test(p) ? 4 : 0) +
        (RISKY_PATH.test(p.split('/').slice(-2).join('/')) ? 0 : 1) +
        (/(^|\/)(src|app|pages|api|lib)\//.test(p) ? 0 : 1);
    const sorted = analyzable.sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path));
    for (const f of sorted.slice(max))
        skipped.push({ path: f.path, reason: 'file_limit' });
    return { selected: sorted.slice(0, max), skipped };
}
function skippedSummary(skipped) {
    const counts = {};
    for (const s of skipped)
        counts[s.reason] = (counts[s.reason] ?? 0) + 1;
    return { counts, files: skipped.slice(0, generated_files_1.MAX_SKIPPED_LISTED) };
}
function partitionAuthored(files, skipped) {
    const authored = [];
    const generated = [];
    for (const f of files) {
        const kind = (0, generated_files_1.classifyNonAuthored)(f.path, f.content);
        if (!kind)
            authored.push(f);
        else {
            skipped.push({ path: f.path, reason: kind });
            if (kind === 'generated')
                generated.push(f);
        }
    }
    return { authored, generated };
}
const REPO_WIDE_SOURCE_TYPES = new Set(['zip', 'github_repo', 'gitlab_repo', 'bitbucket_repo']);
let RepositoryService = RepositoryService_1 = class RepositoryService {
    prisma;
    llm;
    config;
    quota;
    pipeline;
    cache;
    prFeedback;
    reviewRules;
    logger = new common_1.Logger(RepositoryService_1.name);
    constructor(prisma, llm, config, quota, pipeline, cache, prFeedback, reviewRules) {
        this.prisma = prisma;
        this.llm = llm;
        this.config = config;
        this.quota = quota;
        this.pipeline = pipeline;
        this.cache = cache;
        this.prFeedback = prFeedback;
        this.reviewRules = reviewRules;
    }
    async applyRules(actor, sourceName, sourceType, files, rulesFile = null) {
        const rules = (0, review_rules_service_1.withRulesFile)(await this.reviewRules.rulesFor({ id: actor.id, organizationId: actor.organizationId }, (0, review_rules_service_1.repoFromSourceName)(sourceName, sourceType)), rulesFile);
        if (!rules.ignorePaths.length)
            return { rules, files };
        return { rules, files: files.filter((f) => !rules.ignorePaths.some((g) => (0, finding_fingerprint_1.matchesGlob)(f.path, g))) };
    }
    async createScanJob(actor, file, provider) {
        return this.createScanJobFromBuffer(actor, file.buffer, file.originalname, provider);
    }
    async createScanJobFromBuffer(actor, zipBuffer, sourceName, provider, sourceType = 'zip', repoRef, contributorStats, opts = {}) {
        if (!opts.skipQuota) {
            await this.quota.assertCanScanNewRepository(actor.id, (0, repo_key_1.deriveRepoKey)({ sourceName, repoRef }));
        }
        const providerName = this.llm.resolveProvider(provider);
        const maxFileSize = this.config.get('MAX_FILE_SIZE_BYTES') || 200_000;
        const maxScanFiles = this.config.get('MAX_SCAN_FILES') || 40;
        const skipped = [];
        const extracted = (0, file_walker_1.extractZip)(zipBuffer, maxFileSize, skipped);
        const { rules, files } = await this.applyRules(actor, sourceName, sourceType, extracted, (0, review_rules_service_1.repoRulesFile)(extracted));
        const kept = new Set(files.map((f) => f.path));
        for (const f of extracted)
            if (!kept.has(f.path))
                skipped.push({ path: f.path, reason: 'ignored_by_rule' });
        const { authored, generated } = partitionAuthored(files, skipped);
        const framework = (0, framework_detector_1.detectFramework)(files);
        const { graph, circular } = (0, dependency_graph_1.buildDependencyGraph)(authored);
        const deadCode = (0, dead_code_1.findDeadCode)(authored, graph);
        const duplicates = (0, duplicate_code_1.findDuplicates)(authored);
        const secrets = (0, secrets_scanner_1.scanSecrets)([...authored, ...generated]);
        const testCoverage = (0, test_coverage_1.estimateTestCoverage)(authored);
        const [dependencyVulnerabilities, licenseFindings] = await Promise.all([
            (0, dependency_audit_1.auditDependencies)(files),
            (0, license_audit_1.auditLicenses)(files),
        ]);
        const selection = selectFilesToAnalyze(authored, maxScanFiles);
        skipped.push(...selection.skipped);
        const filesToAnalyze = selection.selected;
        const repoContext = `Detected framework: ${framework || 'unknown'}. Repository has ${files.length} files total; ${filesToAnalyze.length} selected for review, riskiest first.`;
        const job = await this.gateAndCreateJob(actor, filesToAnalyze, providerName, {
            sourceName,
            sourceType,
            repoRef: repoRef,
            fileCount: files.length,
            framework,
            dependencyGraph: graph,
            circularImports: circular,
            deadCode: deadCode,
            duplicates: duplicates,
            secrets: secrets,
            dependencyVulnerabilities: dependencyVulnerabilities,
            licenseFindings: licenseFindings,
            testCoverage: testCoverage,
            ...(contributorStats ? { contributorStats: contributorStats } : {}),
            skippedFiles: skippedSummary(skipped),
            localOnly: opts.localOnly,
            isPublic: opts.isPublic,
            shareId: opts.shareId,
            requesterIpHash: opts.requesterIpHash,
        }, rules.key);
        void this.processScan(job.id, filesToAnalyze, providerName, repoContext, Boolean(opts.localOnly), rules);
        return job;
    }
    async createDiffReview(actor, files, meta, opts = {}) {
        if (!opts.skipQuota) {
            await this.quota.assertCanScanNewRepository(actor.id, (0, repo_key_1.deriveRepoKey)({ sourceName: meta.sourceName, prContext: meta.prContext }));
        }
        const providerName = this.llm.resolveProvider(meta.provider);
        const maxFileSize = this.config.get('MAX_FILE_SIZE_BYTES') || 200_000;
        const maxScanFiles = this.config.get('MAX_SCAN_FILES') || 40;
        const scoped = await this.applyRules(actor, meta.sourceName, meta.sourceType, files, (0, review_rules_service_1.repoRulesFile)(files) ?? (0, review_rules_service_1.repoRulesFile)(opts.repoFiles ?? []));
        const rules = scoped.rules;
        const skipped = [];
        const kept = new Set(scoped.files.map((f) => f.path));
        for (const f of files)
            if (!kept.has(f.path))
                skipped.push({ path: f.path, reason: 'ignored_by_rule' });
        const { authored } = partitionAuthored(scoped.files, skipped);
        const analyzable = authored.filter((f) => {
            const ext = f.path.split('.').pop()?.toLowerCase();
            if (!ext || !language_1.ANALYZABLE_EXTENSIONS.has(ext))
                skipped.push({ path: f.path, reason: 'not_source' });
            else if (f.content.length > maxFileSize)
                skipped.push({ path: f.path, reason: 'too_large' });
            else
                return true;
            return false;
        });
        for (const f of analyzable.slice(maxScanFiles))
            skipped.push({ path: f.path, reason: 'file_limit' });
        analyzable.splice(maxScanFiles);
        if (opts.repoFiles?.length && !opts.localOnly) {
            for (const f of analyzable)
                f.relatedContext = (0, related_context_1.relatedContextFor)(f, opts.repoFiles) || undefined;
        }
        const secrets = (0, secrets_scanner_1.scanSecrets)(analyzable);
        const repoContext = `Reviewing a pull/merge request — only the lines this PR/MR actually changed are in scope for each file. ${analyzable.length} file(s) changed.`;
        const job = await this.gateAndCreateJob(actor, analyzable, providerName, {
            sourceName: meta.sourceName,
            sourceType: meta.sourceType,
            pullRequestUrl: meta.pullRequestUrl,
            prContext: meta.prContext,
            changedRanges: Object.fromEntries(analyzable.filter((f) => f.changedRanges).map((f) => [f.path, f.changedRanges])),
            fileCount: analyzable.length,
            secrets: secrets,
            skippedFiles: skippedSummary(skipped),
            localOnly: opts.localOnly,
            isPublic: opts.isPublic,
            shareId: opts.shareId,
            requesterIpHash: opts.requesterIpHash,
            prSnapshot: opts.prSnapshot
                ? {
                    ...opts.prSnapshot,
                    filesReviewed: analyzable.length,
                    filesSkipped: Math.max(opts.prSnapshot.changedFiles - analyzable.length, 0),
                }
                : undefined,
        }, rules.key);
        void this.processScan(job.id, analyzable, providerName, repoContext, Boolean(opts.localOnly), rules);
        return job;
    }
    async gateAndCreateJob(actor, files, providerName, jobDataBase, rulesKey) {
        const willInvokeAi = jobDataBase.localOnly
            ? false
            : await this.anyFileNeedsFreshAiCall(files, providerName, rulesKey);
        const jobData = {
            userId: actor.id,
            organizationId: actor.organizationId,
            status: 'queued',
            provider: providerName,
            ...jobDataBase,
        };
        const isRepoScan = REPO_WIDE_SOURCE_TYPES.has(jobDataBase.sourceType);
        return willInvokeAi
            ? this.quota.withQuotaCheck(async (db) => {
                await this.quota.assertCanRunAudit(actor.id, db);
                if (isRepoScan)
                    await this.quota.assertCanRunAiRepoScan(actor.id, db);
            }, (db) => db.scanJob.create({ data: jobData }))
            : this.prisma.scanJob.create({ data: jobData });
    }
    async anyFileNeedsFreshAiCall(files, providerName, rulesKey) {
        for (const file of files) {
            const hash = this.cache.hashFor(file.content, providerName, [], file.changedRanges, (0, cache_service_1.cacheExtraKey)(rulesKey, file.relatedContext));
            const cached = await this.cache.peek(hash);
            if (cached && (cached.aiInvoked || !file.changedRanges?.length))
                continue;
            if (file.changedRanges?.length)
                return true;
            const fullStage1 = await (0, run_stage1_1.runStage1)(file.content, file.path);
            const stage1 = file.changedRanges ? (0, filter_to_ranges_1.filterStage1ToRanges)(fullStage1, file.changedRanges) : fullStage1;
            if (!stage1.clean)
                return true;
        }
        return false;
    }
    async processScan(jobId, files, providerName, repoContext, localOnly = false, rules = review_rules_service_1.NO_RULES) {
        const teamRules = (0, review_rules_service_1.rulesPromptText)(rules) || undefined;
        const suppressFingerprints = rules.suppress.map((r) => r.fingerprint).filter(Boolean);
        try {
            await this.prisma.scanJob.update({ where: { id: jobId }, data: { status: 'processing' } });
            const limit = pLimit(5);
            let filesFromCache = 0;
            let filesAiSkipped = 0;
            let anyFreshAiInvoked = false;
            const failures = [];
            const results = await Promise.all(files.map((file) => limit(async () => {
                try {
                    const { result, fromCache, usage } = await this.pipeline.run({
                        filename: file.path,
                        language: (0, language_1.detectLanguage)(file.path),
                        code: file.content,
                        provider: providerName,
                        repoContext,
                        changedLineRanges: file.changedRanges,
                        localOnly,
                        teamRules,
                        suppressFingerprints,
                        rulesKey: rules.key || undefined,
                        relatedContext: file.relatedContext,
                    });
                    if (fromCache)
                        filesFromCache++;
                    else if (!result.aiInvoked)
                        filesAiSkipped++;
                    else
                        anyFreshAiInvoked = true;
                    await this.prisma.scanFile.create({
                        data: {
                            scanJobId: jobId,
                            path: file.path,
                            language: (0, language_1.detectLanguage)(file.path),
                            verdict: result.verdict,
                            findings: result.findings,
                            stage1: result.stage1,
                            aiInvoked: result.aiInvoked,
                            fromCache,
                        },
                    });
                    await this.prisma.scanJob.update({
                        where: { id: jobId },
                        data: { filesScanned: { increment: 1 } },
                    });
                    return { path: file.path, result, usage };
                }
                catch (err) {
                    this.logger.warn(`Skipping ${file.path}: ${err.message}`);
                    failures.push({ path: file.path, reason: (0, review_failure_1.reviewFailureReason)(err) });
                    return null;
                }
            })));
            if (files.length && failures.length === files.length) {
                throw new Error(`The AI review couldn't run: ${failures[0].reason}`);
            }
            const succeededByFile = results.filter((r) => r !== null);
            const succeeded = succeededByFile.map((r) => r.result);
            const totalFindings = succeeded.reduce((sum, r) => sum + r.findings.length, 0);
            const overallVerdict = succeeded.length ? (0, verdict_1.worstVerdict)(succeeded.map((r) => r.verdict)) : 'pass';
            let totalUsage = succeededByFile.reduce((sum, r) => (0, types_1.addUsage)(sum, r.usage), types_1.ZERO_USAGE);
            const job = await this.prisma.scanJob.findUniqueOrThrow({ where: { id: jobId } });
            const secretsCount = Array.isArray(job.secrets) ? job.secrets.length : 0;
            const uniqueSecrets = (0, secrets_scanner_1.uniqueSecretCount)(job.secrets);
            let architectureAssessment = null;
            if (REPO_WIDE_SOURCE_TYPES.has(job.sourceType) && anyFreshAiInvoked) {
                const architecturePrompt = (0, architecture_detector_1.buildArchitecturePrompt)(files);
                if (architecturePrompt) {
                    try {
                        const { result, usage } = await this.llm.completeStructured(providerName, architecturePrompt, architecture_detector_1.architectureAssessmentSchema);
                        architectureAssessment = result;
                        totalUsage = (0, types_1.addUsage)(totalUsage, usage);
                    }
                    catch (err) {
                        this.logger.warn(`Architecture assessment failed for scan ${jobId}: ${err.message}`);
                    }
                }
            }
            let prInsights = null;
            if (job.sourceType === 'github_pr' && job.prSnapshot && anyFreshAiInvoked && files.length) {
                try {
                    const { result, usage } = await this.llm.completeStructured(providerName, (0, pr_insights_1.buildInsightsPrompt)({
                        snapshot: job.prSnapshot,
                        files,
                        findings: succeededByFile.flatMap(({ path, result: r }) => r.findings.map((f) => ({ path, severity: f.severity, title: f.title }))),
                    }), pr_insights_1.prInsightsSchema);
                    prInsights = (0, pr_insights_1.softenWordingChecks)(result);
                    totalUsage = (0, types_1.addUsage)(totalUsage, usage);
                }
                catch (err) {
                    this.logger.warn(`PR insights failed for scan ${jobId}: ${err.message}`);
                }
            }
            let crossFileNote = '';
            if (REPO_WIDE_SOURCE_TYPES.has(job.sourceType)) {
                const depVulnCount = Array.isArray(job.dependencyVulnerabilities) ? job.dependencyVulnerabilities.length : 0;
                const licenseCount = Array.isArray(job.licenseFindings) ? job.licenseFindings.length : 0;
                const circularCount = Array.isArray(job.circularImports) ? job.circularImports.length : 0;
                const deadCodeCount = Array.isArray(job.deadCode) ? job.deadCode.length : 0;
                const duplicatesCount = Array.isArray(job.duplicates) ? job.duplicates.length : 0;
                const testCoverageRisk = job.testCoverage && typeof job.testCoverage === 'object' && 'riskLevel' in job.testCoverage
                    ? job.testCoverage.riskLevel
                    : null;
                crossFileNote = ` ${depVulnCount} vulnerable dependency issue(s), ${licenseCount} license compliance issue(s), ${circularCount} circular import chain(s), ${deadCodeCount} possibly dead file(s), ${duplicatesCount} duplicate block(s),${testCoverageRisk ? ` ${testCoverageRisk} test-coverage risk,` : ''}${architectureAssessment ? ` architecture consistency ${architectureAssessment.consistencyScore}/100,` : ''}`;
            }
            const failureNote = failures.length
                ? ` ${failures.length} file(s) couldn't be reviewed (${failures
                    .slice(0, 3)
                    .map((f) => f.path)
                    .join(', ')}${failures.length > 3 ? ', …' : ''}): ${failures[0].reason}`
                : '';
            const { verdict, reasons: verdictReasons } = (0, reconcile_verdict_1.reconcileVerdict)(overallVerdict, {
                uniqueSecrets,
                risk: REPO_WIDE_SOURCE_TYPES.has(job.sourceType)
                    ? (0, risk_aggregation_1.aggregateRisk)({
                        ...job,
                        files: succeeded.map((r) => ({ findings: r.findings })),
                        architectureAssessment,
                    })
                    : null,
            });
            const aiReviewed = succeeded.length - filesFromCache - filesAiSkipped;
            const secretNote = secretsCount > 0
                ? ` ${uniqueSecrets} distinct potential secret(s) in ${secretsCount} place(s).`
                : ' No secrets found.';
            const summary = `Reviewed ${succeeded.length}/${files.length} selected files (of ${job.fileCount} total): ${aiReviewed} reviewed by AI, ${filesFromCache} from cache, ${filesAiSkipped} passed local checks with nothing risky enough to send to AI. Found ${totalFindings} finding(s),${crossFileNote}${secretNote}${failureNote}${verdictReasons.length ? ` Verdict set by: ${verdictReasons.join('; ')}.` : ''}`;
            await this.prisma.scanJob.update({
                where: { id: jobId },
                data: {
                    status: 'completed',
                    verdict,
                    summary,
                    filesFromCache,
                    filesAiSkipped,
                    aiInvoked: anyFreshAiInvoked,
                    inputTokens: totalUsage.inputTokens,
                    outputTokens: totalUsage.outputTokens,
                    architectureAssessment: architectureAssessment,
                    ...(prInsights ? { prInsights: prInsights } : {}),
                    completedAt: new Date(),
                },
            });
            if (job.prContext)
                await this.publishPrFeedback(jobId);
        }
        catch (err) {
            this.logger.error(`Scan ${jobId} failed`, err);
            const failed = await this.prisma.scanJob.update({
                where: { id: jobId },
                data: { status: 'failed', error: err.message, completedAt: new Date() },
            });
            if (failed.prContext) {
                await this.prFeedback.fail(failed.userId, failed.prContext, 'Audit Bench Ai couldn’t finish reviewing this commit. Push another commit, or click Re-run, to try again.');
            }
        }
    }
    async republishPrFeedback(actor, id) {
        const job = await this.prisma.scanJob.findUnique({ where: { id } });
        if (!job || !(0, workspace_scope_1.canViewResource)(actor, job))
            throw new common_1.NotFoundException(`Scan ${id} not found`);
        if (!job.prContext)
            throw new common_1.BadRequestException('This review was kept in the app, so there is nothing to post.');
        if (job.status !== 'completed')
            throw new common_1.BadRequestException('Wait for the review to finish before posting it.');
        return this.publishPrFeedback(id);
    }
    async publishPrFeedback(jobId) {
        const job = await this.prisma.scanJob.findUniqueOrThrow({ where: { id: jobId } });
        if (!job.prContext || job.status !== 'completed') {
            return { prPublishedAt: job.prPublishedAt, prPublishError: job.prPublishError };
        }
        const feedback = await this.buildPrFeedback(jobId, this.buildScanUrl(jobId));
        const outcome = await this.prFeedback.publish(job.userId, job.prContext, feedback);
        const data = outcome.ok
            ? { prPublishedAt: new Date(), prPublishError: null }
            : { prPublishedAt: null, prPublishError: outcome.error };
        await this.prisma.scanJob.update({ where: { id: jobId }, data });
        return data;
    }
    async buildPrFeedback(jobId, scanUrl) {
        const job = await this.prisma.scanJob.findUniqueOrThrow({ where: { id: jobId }, include: { files: true } });
        const snapshot = job.sourceType === 'github_pr' ? job.prSnapshot : null;
        const findings = (0, inline_comment_1.withoutConflictingReplacements)(job.files.flatMap((file) => (Array.isArray(file.findings) ? file.findings : []).map((f) => ({
            path: file.path,
            line: f.line,
            endLine: f.endLine ?? null,
            severity: f.severity,
            title: f.title,
            description: f.description,
            category: f.category,
            rootCause: f.rootCause,
            suggestedFix: f.suggestedFix,
            examplePatch: f.examplePatch,
            replacement: f.replacement ?? null,
            confidence: f.confidence,
        }))));
        const insights = (job.prInsights ?? undefined);
        const checks = snapshot
            ? (0, pr_insights_1.deterministicChecks)(snapshot, {
                findings,
                secrets: Array.isArray(job.secrets) ? job.secrets.length : 0,
                changedPaths: Object.keys((job.changedRanges ?? {})),
            })
            : undefined;
        return {
            verdict: job.verdict ?? 'pass',
            summary: job.summary ?? '',
            findings,
            changedRanges: (job.changedRanges ?? undefined),
            scanUrl,
            readiness: (0, pr_insights_1.reconcileReadiness)((0, merge_readiness_1.readinessForScan)(job) ?? undefined, [
                ...(checks ?? []),
                ...(insights?.checks ?? []).map((c) => ({ ...c, resolution: c.resolution ?? undefined })),
            ]),
            headSha: snapshot?.headSha,
            insights,
            checks,
            local: job.localOnly,
        };
    }
    buildScanUrl(jobId) {
        const origin = (this.config.get('FRONTEND_ORIGIN') || '').split(',')[0]?.trim();
        return origin ? `${origin}/app/repository/${jobId}` : undefined;
    }
    async findOne(actor, id) {
        const job = await this.prisma.scanJob.findUnique({
            where: { id },
            include: { files: true },
        });
        if (!job || !(0, workspace_scope_1.canViewResource)(actor, job))
            throw new common_1.NotFoundException(`Scan ${id} not found`);
        const riskAggregation = job.status === 'completed' ? (0, risk_aggregation_1.aggregateRisk)(job) : null;
        const tddAssessment = riskAggregation && (await this.quota.canUseDueDiligence(actor.id, actor.role))
            ? (0, tdd_assessment_1.assessTdd)(job, riskAggregation)
            : null;
        return { ...job, riskAggregation, tddAssessment, mergeReadiness: (0, merge_readiness_1.readinessForScan)(job) };
    }
    async setFindingStatus(actor, scanFileId, findingIndex, status) {
        if (!finding_schema_1.FINDING_STATUSES.includes(status)) {
            throw new common_1.BadRequestException(`status must be one of: ${finding_schema_1.FINDING_STATUSES.join(', ')}`);
        }
        const file = await this.prisma.scanFile.findUnique({
            where: { id: scanFileId },
            include: { scanJob: true },
        });
        if (!file || !(0, workspace_scope_1.canViewResource)(actor, file.scanJob))
            throw new common_1.NotFoundException(`Scan file ${scanFileId} not found`);
        const findings = file.findings;
        if (findingIndex < 0 || findingIndex >= findings.length) {
            throw new common_1.BadRequestException(`No finding at index ${findingIndex}`);
        }
        const statuses = { ...(file.findingStatuses ?? {}) };
        if (status === 'open')
            delete statuses[findingIndex];
        else
            statuses[findingIndex] = status;
        const updated = await this.prisma.scanFile.update({
            where: { id: scanFileId },
            data: { findingStatuses: statuses },
        });
        const repo = (0, review_rules_service_1.repoFromSourceName)(file.scanJob.sourceName, file.scanJob.sourceType);
        if (repo) {
            const owner = { id: file.scanJob.userId, organizationId: file.scanJob.organizationId };
            const sourceRef = `app:${scanFileId}:${findingIndex}`;
            const f = findings[findingIndex];
            if (status === 'wont_fix') {
                await this.reviewRules.recordFeedback(owner, {
                    repo,
                    path: file.path,
                    category: f.category,
                    title: f.title,
                    signal: 'wont_fix',
                    source: 'app',
                    sourceRef,
                });
            }
            else {
                await this.reviewRules.withdrawFeedback(owner, sourceRef);
            }
        }
        return updated;
    }
    async remove(actor, id) {
        const job = await this.prisma.scanJob.findUnique({ where: { id } });
        if (!job || !(0, workspace_scope_1.canViewResource)(actor, job))
            throw new common_1.NotFoundException(`Scan ${id} not found`);
        if (job.userId !== actor.id)
            throw new common_1.ForbiddenException('Only the person who ran this scan can delete it.');
        await this.prisma.scanJob.delete({ where: { id } });
        return { deleted: true };
    }
    async findRecent(actor, limit = 20) {
        return this.prisma.scanJob.findMany({
            where: (0, workspace_scope_1.workspaceWhere)(actor),
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    }
};
exports.RepositoryService = RepositoryService;
exports.RepositoryService = RepositoryService = RepositoryService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        llm_service_1.LlmService,
        config_1.ConfigService,
        quota_service_1.QuotaService,
        pipeline_service_1.PipelineService,
        cache_service_1.AuditCacheService,
        pr_feedback_service_1.PrFeedbackService,
        review_rules_service_1.ReviewRulesService])
], RepositoryService);
//# sourceMappingURL=repository.service.js.map