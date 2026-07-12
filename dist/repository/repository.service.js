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
const dependency_audit_1 = require("../analysis/dependency-audit");
const verdict_1 = require("../common/verdict");
const pr_feedback_service_1 = require("../pr-feedback/pr-feedback.service");
const workspace_scope_1 = require("../common/workspace-scope");
function selectFilesToAnalyze(files, max) {
    const analyzable = files.filter((f) => {
        const ext = f.path.split('.').pop()?.toLowerCase();
        return ext && language_1.ANALYZABLE_EXTENSIONS.has(ext);
    });
    const priority = (p) => (/(^|\/)(src|app|pages|api|lib)\//.test(p) ? 0 : 1);
    return analyzable
        .sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path))
        .slice(0, max);
}
const REPO_WIDE_SOURCE_TYPES = new Set(['zip', 'github_repo', 'gitlab_repo']);
let RepositoryService = RepositoryService_1 = class RepositoryService {
    prisma;
    llm;
    config;
    quota;
    pipeline;
    cache;
    prFeedback;
    logger = new common_1.Logger(RepositoryService_1.name);
    constructor(prisma, llm, config, quota, pipeline, cache, prFeedback) {
        this.prisma = prisma;
        this.llm = llm;
        this.config = config;
        this.quota = quota;
        this.pipeline = pipeline;
        this.cache = cache;
        this.prFeedback = prFeedback;
    }
    async createScanJob(actor, file, provider) {
        return this.createScanJobFromBuffer(actor, file.buffer, file.originalname, provider);
    }
    async createScanJobFromBuffer(actor, zipBuffer, sourceName, provider, sourceType = 'zip', repoRef) {
        await this.quota.assertPlanAllowsRepositoryScan(actor.id);
        const providerName = this.llm.resolveProvider(provider);
        const maxFileSize = this.config.get('MAX_FILE_SIZE_BYTES') || 200_000;
        const maxScanFiles = this.config.get('MAX_SCAN_FILES') || 40;
        const files = (0, file_walker_1.extractZip)(zipBuffer, maxFileSize);
        const framework = (0, framework_detector_1.detectFramework)(files);
        const { graph, circular } = (0, dependency_graph_1.buildDependencyGraph)(files);
        const deadCode = (0, dead_code_1.findDeadCode)(files, graph);
        const duplicates = (0, duplicate_code_1.findDuplicates)(files);
        const secrets = (0, secrets_scanner_1.scanSecrets)(files);
        const dependencyVulnerabilities = await (0, dependency_audit_1.auditDependencies)(files);
        const filesToAnalyze = selectFilesToAnalyze(files, maxScanFiles);
        const repoContext = `Detected framework: ${framework || 'unknown'}. Repository has ${files.length} files total; ${filesToAnalyze.length} selected for review.`;
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
        });
        void this.processScan(job.id, filesToAnalyze, providerName, repoContext);
        return job;
    }
    async createDiffReview(actor, files, meta) {
        await this.quota.assertPlanAllowsRepositoryScan(actor.id);
        const providerName = this.llm.resolveProvider(meta.provider);
        const maxFileSize = this.config.get('MAX_FILE_SIZE_BYTES') || 200_000;
        const maxScanFiles = this.config.get('MAX_SCAN_FILES') || 40;
        const analyzable = files
            .filter((f) => {
            const ext = f.path.split('.').pop()?.toLowerCase();
            return Boolean(ext && language_1.ANALYZABLE_EXTENSIONS.has(ext) && f.content.length <= maxFileSize);
        })
            .slice(0, maxScanFiles);
        const secrets = (0, secrets_scanner_1.scanSecrets)(analyzable);
        const repoContext = `Reviewing a pull/merge request — only the lines this PR/MR actually changed are in scope for each file. ${analyzable.length} file(s) changed.`;
        const job = await this.gateAndCreateJob(actor, analyzable, providerName, {
            sourceName: meta.sourceName,
            sourceType: meta.sourceType,
            pullRequestUrl: meta.pullRequestUrl,
            prContext: meta.prContext,
            fileCount: analyzable.length,
            secrets: secrets,
        });
        void this.processScan(job.id, analyzable, providerName, repoContext);
        return job;
    }
    async gateAndCreateJob(actor, files, providerName, jobDataBase) {
        const willInvokeAi = await this.anyFileNeedsFreshAiCall(files, providerName);
        const jobData = {
            userId: actor.id,
            organizationId: actor.organizationId,
            status: 'queued',
            provider: providerName,
            ...jobDataBase,
        };
        return willInvokeAi
            ? this.quota.withQuotaCheck((db) => this.quota.assertCanRunAudit(actor.id, db), (db) => db.scanJob.create({ data: jobData }))
            : this.prisma.scanJob.create({ data: jobData });
    }
    async anyFileNeedsFreshAiCall(files, providerName) {
        for (const file of files) {
            const hash = this.cache.hashFor(file.content, providerName, [], file.changedRanges);
            if (await this.cache.exists(hash))
                continue;
            const fullStage1 = await (0, run_stage1_1.runStage1)(file.content, file.path);
            const stage1 = file.changedRanges ? (0, filter_to_ranges_1.filterStage1ToRanges)(fullStage1, file.changedRanges) : fullStage1;
            if (!stage1.clean)
                return true;
        }
        return false;
    }
    async processScan(jobId, files, providerName, repoContext) {
        try {
            await this.prisma.scanJob.update({ where: { id: jobId }, data: { status: 'processing' } });
            const limit = pLimit(5);
            let filesFromCache = 0;
            let filesAiSkipped = 0;
            let anyFreshAiInvoked = false;
            const results = await Promise.all(files.map((file) => limit(async () => {
                try {
                    const { result, fromCache } = await this.pipeline.run({
                        filename: file.path,
                        language: (0, language_1.detectLanguage)(file.path),
                        code: file.content,
                        provider: providerName,
                        repoContext,
                        changedLineRanges: file.changedRanges,
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
                    return { path: file.path, result };
                }
                catch (err) {
                    this.logger.warn(`Skipping ${file.path}: ${err.message}`);
                    return null;
                }
            })));
            const succeededByFile = results.filter((r) => r !== null);
            const succeeded = succeededByFile.map((r) => r.result);
            const totalFindings = succeeded.reduce((sum, r) => sum + r.findings.length, 0);
            const overallVerdict = succeeded.length ? (0, verdict_1.worstVerdict)(succeeded.map((r) => r.verdict)) : 'pass';
            const job = await this.prisma.scanJob.findUniqueOrThrow({ where: { id: jobId } });
            const secretsCount = Array.isArray(job.secrets) ? job.secrets.length : 0;
            let crossFileNote = '';
            if (REPO_WIDE_SOURCE_TYPES.has(job.sourceType)) {
                const depVulnCount = Array.isArray(job.dependencyVulnerabilities) ? job.dependencyVulnerabilities.length : 0;
                const circularCount = Array.isArray(job.circularImports) ? job.circularImports.length : 0;
                const deadCodeCount = Array.isArray(job.deadCode) ? job.deadCode.length : 0;
                const duplicatesCount = Array.isArray(job.duplicates) ? job.duplicates.length : 0;
                crossFileNote = ` ${depVulnCount} vulnerable dependency issue(s), ${circularCount} circular import chain(s), ${deadCodeCount} possibly dead file(s), ${duplicatesCount} duplicate block(s),`;
            }
            const summary = `Reviewed ${succeeded.length}/${files.length} files (of ${job.fileCount} total) — ${filesFromCache} from cache, ${filesAiSkipped} needed no AI review. Found ${totalFindings} finding(s),${crossFileNote} ${secretsCount} potential secret(s).`;
            await this.prisma.scanJob.update({
                where: { id: jobId },
                data: {
                    status: 'completed',
                    verdict: overallVerdict,
                    summary,
                    filesFromCache,
                    filesAiSkipped,
                    aiInvoked: anyFreshAiInvoked,
                    completedAt: new Date(),
                },
            });
            if (job.prContext) {
                const feedback = {
                    verdict: overallVerdict,
                    summary,
                    findings: succeededByFile.flatMap(({ path, result }) => result.findings.map((f) => ({
                        path,
                        line: f.line,
                        severity: f.severity,
                        title: f.title,
                        description: f.description,
                    }))),
                    scanUrl: this.buildScanUrl(jobId),
                };
                await this.prFeedback.publish(job.userId, job.prContext, feedback);
            }
        }
        catch (err) {
            this.logger.error(`Scan ${jobId} failed`, err);
            await this.prisma.scanJob.update({
                where: { id: jobId },
                data: { status: 'failed', error: err.message, completedAt: new Date() },
            });
        }
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
        return job;
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
        pr_feedback_service_1.PrFeedbackService])
], RepositoryService);
//# sourceMappingURL=repository.service.js.map