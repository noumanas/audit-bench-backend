import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pLimit = require('p-limit');
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../llm/llm.service';
import { QuotaService } from '../quota/quota.service';
import { PipelineService } from '../audit/pipeline.service';
import { AuditCacheService } from '../audit/cache.service';
import { runStage1 } from '../audit/stage1/run-stage1';
import { filterStage1ToRanges } from '../audit/stage1/filter-to-ranges';
import { detectLanguage, ANALYZABLE_EXTENSIONS } from '../common/language';
import { extractZip } from '../analysis/file-walker';
import { detectFramework } from '../analysis/framework-detector';
import { buildDependencyGraph } from '../analysis/dependency-graph';
import { findDeadCode } from '../analysis/dead-code';
import { findDuplicates } from '../analysis/duplicate-code';
import { scanSecrets } from '../analysis/secrets-scanner';
import { auditDependencies } from '../analysis/dependency-audit';
import { auditLicenses } from '../analysis/license-audit';
import { estimateTestCoverage } from '../analysis/test-coverage';
import { buildArchitecturePrompt, architectureAssessmentSchema, ArchitectureAssessment } from '../audit/architecture-detector';
import { assessTdd } from './tdd-assessment';
import { aggregateRisk } from './risk-aggregation';
import { ScannedFile, ContributorStat } from '../analysis/types';
import { LlmProviderName, ZERO_USAGE, addUsage } from '../common/types';
import { worstVerdict } from '../common/verdict';
import { Prisma, ScanSourceType } from '@prisma/client';
import { PrFeedbackService } from '../pr-feedback/pr-feedback.service';
import { PrSnapshot, readinessForScan } from '../common/merge-readiness';
import { PrInsights, buildInsightsPrompt, deterministicChecks, prInsightsSchema } from '../pr-feedback/pr-insights';
import { PrContext, PrFeedback } from '../pr-feedback/pr-feedback.types';
import { Finding, FindingStatus, FindingStatuses, FINDING_STATUSES } from '../common/finding.schema';
import { RepoRef } from '../common/repo-ref.types';
import { deriveRepoKey } from '../common/repo-key';
import { WorkspaceActor, workspaceWhere, canViewResource } from '../common/workspace-scope';

function selectFilesToAnalyze(files: ScannedFile[], max: number): ScannedFile[] {
  const analyzable = files.filter((f) => {
    const ext = f.path.split('.').pop()?.toLowerCase();
    return ext && ANALYZABLE_EXTENSIONS.has(ext);
  });

  // Prioritize likely-important source directories over config/scripts.
  const priority = (p: string) => (/(^|\/)(src|app|pages|api|lib)\//.test(p) ? 0 : 1);

  return analyzable
    .sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path))
    .slice(0, max);
}

/** Extra behaviour for a scan that doesn't come from a signed-in user's own quota — see PublicScanService. */
export interface ScanOptions {
  /** Skip the plan/repository-count gate (the caller enforces its own limits). */
  skipQuota?: boolean;
  /** Never call the AI — Stage 1 and cross-file analysis only. */
  localOnly?: boolean;
  isPublic?: boolean;
  shareId?: string;
  requesterIpHash?: string;
  /** GitHub PR reviews — merge state and CI checks, see common/merge-readiness.ts. */
  prSnapshot?: PrSnapshot;
}

interface JobDataBase {
  sourceName: string;
  localOnly?: boolean;
  isPublic?: boolean;
  shareId?: string;
  requesterIpHash?: string;
  prSnapshot?: Prisma.InputJsonValue;
  changedRanges?: Prisma.InputJsonValue;
  sourceType: ScanSourceType;
  pullRequestUrl?: string;
  prContext?: Prisma.InputJsonValue;
  repoRef?: Prisma.InputJsonValue;
  framework?: string | null;
  fileCount: number;
  dependencyGraph?: Prisma.InputJsonValue;
  circularImports?: Prisma.InputJsonValue;
  deadCode?: Prisma.InputJsonValue;
  duplicates?: Prisma.InputJsonValue;
  secrets?: Prisma.InputJsonValue;
  dependencyVulnerabilities?: Prisma.InputJsonValue;
  licenseFindings?: Prisma.InputJsonValue;
  testCoverage?: Prisma.InputJsonValue;
  contributorStats?: Prisma.InputJsonValue;
}

const REPO_WIDE_SOURCE_TYPES = new Set<ScanSourceType>(['zip', 'github_repo', 'gitlab_repo']);

@Injectable()
export class RepositoryService {
  private readonly logger = new Logger(RepositoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    private readonly config: ConfigService,
    private readonly quota: QuotaService,
    private readonly pipeline: PipelineService,
    private readonly cache: AuditCacheService,
    private readonly prFeedback: PrFeedbackService,
  ) {}

  async createScanJob(actor: WorkspaceActor, file: Express.Multer.File, provider?: string) {
    return this.createScanJobFromBuffer(actor, file.buffer, file.originalname, provider);
  }

  /** Shared by the zip-upload controller and the GitHub/GitLab repo-import flows. */
  async createScanJobFromBuffer(
    actor: WorkspaceActor,
    zipBuffer: Buffer,
    sourceName: string,
    provider?: string,
    sourceType: ScanSourceType = 'zip',
    // Set for github_repo / gitlab_repo — lets FixService branch off the
    // scanned ref and open a PR/MR once the user commits a fix.
    repoRef?: RepoRef,
    // Set for github_repo / gitlab_repo — per-contributor commit stats
    // fetched from the provider alongside the zip download (see
    // GithubController/GitlabController). Absent for a zip upload, which
    // has no git host to source this from.
    contributorStats?: ContributorStat[],
    opts: ScanOptions = {},
  ) {
    if (!opts.skipQuota) {
      await this.quota.assertCanScanNewRepository(actor.id, deriveRepoKey({ sourceName, repoRef }));
    }

    const providerName = this.llm.resolveProvider(provider);
    const maxFileSize = this.config.get<number>('MAX_FILE_SIZE_BYTES') || 200_000;
    const maxScanFiles = this.config.get<number>('MAX_SCAN_FILES') || 40;

    const files = extractZip(zipBuffer, maxFileSize);
    const framework = detectFramework(files);
    const { graph, circular } = buildDependencyGraph(files);
    const deadCode = findDeadCode(files, graph);
    const duplicates = findDuplicates(files);
    const secrets = scanSecrets(files);
    const testCoverage = estimateTestCoverage(files);
    const [dependencyVulnerabilities, licenseFindings] = await Promise.all([
      auditDependencies(files),
      auditLicenses(files),
    ]);
    const filesToAnalyze = selectFilesToAnalyze(files, maxScanFiles);
    const repoContext = `Detected framework: ${framework || 'unknown'}. Repository has ${files.length} files total; ${filesToAnalyze.length} selected for review.`;

    const job = await this.gateAndCreateJob(actor, filesToAnalyze, providerName, {
      sourceName,
      sourceType,
      repoRef: repoRef as unknown as Prisma.InputJsonValue,
      fileCount: files.length,
      framework,
      dependencyGraph: graph as unknown as Prisma.InputJsonValue,
      circularImports: circular as unknown as Prisma.InputJsonValue,
      deadCode: deadCode as unknown as Prisma.InputJsonValue,
      duplicates: duplicates as unknown as Prisma.InputJsonValue,
      secrets: secrets as unknown as Prisma.InputJsonValue,
      dependencyVulnerabilities: dependencyVulnerabilities as unknown as Prisma.InputJsonValue,
      licenseFindings: licenseFindings as unknown as Prisma.InputJsonValue,
      testCoverage: testCoverage as unknown as Prisma.InputJsonValue,
      ...(contributorStats ? { contributorStats: contributorStats as unknown as Prisma.InputJsonValue } : {}),
      localOnly: opts.localOnly,
      isPublic: opts.isPublic,
      shareId: opts.shareId,
      requesterIpHash: opts.requesterIpHash,
    });

    void this.processScan(job.id, filesToAnalyze, providerName, repoContext, Boolean(opts.localOnly));
    return job;
  }

  /**
   * Reviews a GitHub PR / GitLab MR, scoped to the diff — each file's
   * `changedRanges` (set by the caller) restricts both what gets reported
   * and what gets escalated to AI. Skips whole-repo analysis (dependency
   * graph, dead code, duplicates) since that's not meaningful on a handful
   * of changed files rather than the full tree; secrets scanning still
   * runs since it's per-file.
   */
  async createDiffReview(
    actor: WorkspaceActor,
    files: ScannedFile[],
    meta: {
      sourceName: string;
      sourceType: 'github_pr' | 'gitlab_mr';
      pullRequestUrl: string;
      provider?: string;
      /** Set so processScan can publish the review/summary/status back once the scan completes. */
      prContext?: PrContext;
    },
    opts: ScanOptions = {},
  ) {
    if (!opts.skipQuota) {
      await this.quota.assertCanScanNewRepository(
        actor.id,
        deriveRepoKey({ sourceName: meta.sourceName, prContext: meta.prContext }),
      );
    }

    const providerName = this.llm.resolveProvider(meta.provider);
    const maxFileSize = this.config.get<number>('MAX_FILE_SIZE_BYTES') || 200_000;
    const maxScanFiles = this.config.get<number>('MAX_SCAN_FILES') || 40;

    const analyzable = files
      .filter((f) => {
        const ext = f.path.split('.').pop()?.toLowerCase();
        return Boolean(ext && ANALYZABLE_EXTENSIONS.has(ext) && f.content.length <= maxFileSize);
      })
      .slice(0, maxScanFiles);

    const secrets = scanSecrets(analyzable);
    const repoContext = `Reviewing a pull/merge request — only the lines this PR/MR actually changed are in scope for each file. ${analyzable.length} file(s) changed.`;

    const job = await this.gateAndCreateJob(actor, analyzable, providerName, {
      sourceName: meta.sourceName,
      sourceType: meta.sourceType,
      pullRequestUrl: meta.pullRequestUrl,
      prContext: meta.prContext as unknown as Prisma.InputJsonValue,
      changedRanges: Object.fromEntries(
        analyzable.filter((f) => f.changedRanges).map((f) => [f.path, f.changedRanges!]),
      ) as unknown as Prisma.InputJsonValue,
      fileCount: analyzable.length,
      secrets: secrets as unknown as Prisma.InputJsonValue,
      localOnly: opts.localOnly,
      isPublic: opts.isPublic,
      shareId: opts.shareId,
      requesterIpHash: opts.requesterIpHash,
      // Counted here, after the language and size filter, so "not reviewed" is accurate.
      prSnapshot: opts.prSnapshot
        ? ({
            ...opts.prSnapshot,
            filesReviewed: analyzable.length,
            filesSkipped: Math.max(opts.prSnapshot.changedFiles - analyzable.length, 0),
          } as unknown as Prisma.InputJsonValue)
        : undefined,
    });

    void this.processScan(job.id, analyzable, providerName, repoContext, Boolean(opts.localOnly));
    return job;
  }

  private async gateAndCreateJob(
    actor: WorkspaceActor,
    files: ScannedFile[],
    providerName: LlmProviderName,
    jobDataBase: JobDataBase,
  ) {
    // Cheap, local-only pre-check: will this job make at least one fresh
    // LLM call? Only then does it need a quota gate — a scan/review that
    // turns out entirely clean (or fully cache-hit) never touches quota,
    // and one that's already at its limit isn't blocked from attempting a
    // scan that might cost nothing. See QuotaService for the full rationale.
    const willInvokeAi = jobDataBase.localOnly ? false : await this.anyFileNeedsFreshAiCall(files, providerName);
    const jobData = {
      userId: actor.id,
      // Same team-visibility stamp as Audit — see AuditService.runAudit.
      organizationId: actor.organizationId,
      status: 'queued' as const,
      provider: providerName,
      ...jobDataBase,
    };

    // A repository scan (not a PR/MR review) that spends on AI also draws
    // from the plan's monthly repo-scan allowance, checked in the same
    // serializable transaction as the audit quota.
    const isRepoScan = REPO_WIDE_SOURCE_TYPES.has(jobDataBase.sourceType);
    return willInvokeAi
      ? this.quota.withQuotaCheck(
          async (db) => {
            await this.quota.assertCanRunAudit(actor.id, db);
            if (isRepoScan) await this.quota.assertCanRunAiRepoScan(actor.id, db);
          },
          (db) => db.scanJob.create({ data: jobData }),
        )
      : this.prisma.scanJob.create({ data: jobData });
  }

  private async anyFileNeedsFreshAiCall(files: ScannedFile[], providerName: LlmProviderName): Promise<boolean> {
    for (const file of files) {
      const hash = this.cache.hashFor(file.content, providerName, [], file.changedRanges);
      if (await this.cache.exists(hash)) continue; // cached — no fresh call needed for this file
      if (file.changedRanges?.length) return true; // PR/MR hunks always get an AI pass — see PipelineService.run
      const fullStage1 = await runStage1(file.content, file.path);
      const stage1 = file.changedRanges ? filterStage1ToRanges(fullStage1, file.changedRanges) : fullStage1;
      if (!stage1.clean) return true;
    }
    return false;
  }

  private async processScan(
    jobId: string,
    files: ScannedFile[],
    providerName: LlmProviderName,
    repoContext: string,
    localOnly = false,
  ) {
    try {
      await this.prisma.scanJob.update({ where: { id: jobId }, data: { status: 'processing' } });

      const limit = pLimit(5);
      let filesFromCache = 0;
      let filesAiSkipped = 0;
      let anyFreshAiInvoked = false;

      const results = await Promise.all(
        files.map((file) =>
          limit(async () => {
            try {
              const { result, fromCache, usage } = await this.pipeline.run({
                filename: file.path,
                language: detectLanguage(file.path),
                code: file.content,
                provider: providerName,
                repoContext,
                changedLineRanges: file.changedRanges,
                localOnly,
              });

              if (fromCache) filesFromCache++;
              else if (!result.aiInvoked) filesAiSkipped++;
              else anyFreshAiInvoked = true;

              await this.prisma.scanFile.create({
                data: {
                  scanJobId: jobId,
                  path: file.path,
                  language: detectLanguage(file.path),
                  verdict: result.verdict,
                  findings: result.findings as unknown as Prisma.InputJsonValue,
                  stage1: result.stage1 as unknown as Prisma.InputJsonValue,
                  aiInvoked: result.aiInvoked,
                  fromCache,
                },
              });
              await this.prisma.scanJob.update({
                where: { id: jobId },
                data: { filesScanned: { increment: 1 } },
              });
              return { path: file.path, result, usage };
            } catch (err) {
              this.logger.warn(`Skipping ${file.path}: ${(err as Error).message}`);
              return null;
            }
          }),
        ),
      );

      const succeededByFile = results.filter((r): r is NonNullable<typeof r> => r !== null);
      const succeeded = succeededByFile.map((r) => r.result);
      const totalFindings = succeeded.reduce((sum, r) => sum + r.findings.length, 0);
      const overallVerdict = succeeded.length ? worstVerdict(succeeded.map((r) => r.verdict)) : 'pass';
      let totalUsage = succeededByFile.reduce((sum, r) => addUsage(sum, r.usage), ZERO_USAGE);

      const job = await this.prisma.scanJob.findUniqueOrThrow({ where: { id: jobId } });
      const secretsCount = Array.isArray(job.secrets) ? job.secrets.length : 0;

      // A repo-level judgment, not a per-file one — can't ride the
      // per-file "only escalate risky code" free-tier logic above. Only
      // runs when this scan already needed a fresh AI call for at least one
      // file, so it rides a job that's already quota-gated rather than
      // opening a new unmetered AI cost path on an otherwise-clean, free scan.
      let architectureAssessment: ArchitectureAssessment | null = null;
      if (REPO_WIDE_SOURCE_TYPES.has(job.sourceType) && anyFreshAiInvoked) {
        const architecturePrompt = buildArchitecturePrompt(files);
        if (architecturePrompt) {
          try {
            const { result, usage } = await this.llm.completeStructured<ArchitectureAssessment>(
              providerName,
              architecturePrompt,
              architectureAssessmentSchema,
            );
            architectureAssessment = result;
            totalUsage = addUsage(totalUsage, usage);
          } catch (err) {
            this.logger.warn(`Architecture assessment failed for scan ${jobId}: ${(err as Error).message}`);
          }
        }
      }

      // One AI read of the PR as a whole (walkthrough, merge risk, title /
      // description / linked-issue / scope checks) for the posted summary.
      // Same rule as the architecture read: only on a review that already
      // made a fresh, quota-gated AI call.
      let prInsights: PrInsights | null = null;
      if (job.sourceType === 'github_pr' && job.prSnapshot && anyFreshAiInvoked && files.length) {
        try {
          const { result, usage } = await this.llm.completeStructured<PrInsights>(
            providerName,
            buildInsightsPrompt({
              snapshot: job.prSnapshot as unknown as PrSnapshot,
              files,
              findings: succeededByFile.flatMap(({ path, result: r }) =>
                r.findings.map((f) => ({ path, severity: f.severity, title: f.title })),
              ),
            }),
            prInsightsSchema,
          );
          prInsights = result;
          totalUsage = addUsage(totalUsage, usage);
        } catch (err) {
          this.logger.warn(`PR insights failed for scan ${jobId}: ${(err as Error).message}`);
        }
      }

      let crossFileNote = '';
      if (REPO_WIDE_SOURCE_TYPES.has(job.sourceType)) {
        const depVulnCount = Array.isArray(job.dependencyVulnerabilities) ? job.dependencyVulnerabilities.length : 0;
        const licenseCount = Array.isArray(job.licenseFindings) ? job.licenseFindings.length : 0;
        const circularCount = Array.isArray(job.circularImports) ? job.circularImports.length : 0;
        const deadCodeCount = Array.isArray(job.deadCode) ? job.deadCode.length : 0;
        const duplicatesCount = Array.isArray(job.duplicates) ? job.duplicates.length : 0;
        const testCoverageRisk =
          job.testCoverage && typeof job.testCoverage === 'object' && 'riskLevel' in job.testCoverage
            ? (job.testCoverage as unknown as { riskLevel: string }).riskLevel
            : null;
        crossFileNote = ` ${depVulnCount} vulnerable dependency issue(s), ${licenseCount} license compliance issue(s), ${circularCount} circular import chain(s), ${deadCodeCount} possibly dead file(s), ${duplicatesCount} duplicate block(s),${testCoverageRisk ? ` ${testCoverageRisk} test-coverage risk,` : ''}${architectureAssessment ? ` architecture consistency ${architectureAssessment.consistencyScore}/100,` : ''}`;
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
          inputTokens: totalUsage.inputTokens,
          outputTokens: totalUsage.outputTokens,
          architectureAssessment: architectureAssessment as unknown as Prisma.InputJsonValue,
          ...(prInsights ? { prInsights: prInsights as unknown as Prisma.InputJsonValue } : {}),
          completedAt: new Date(),
        },
      });

      if (job.prContext) await this.publishPrFeedback(jobId);
    } catch (err) {
      this.logger.error(`Scan ${jobId} failed`, err as Error);
      await this.prisma.scanJob.update({
        where: { id: jobId },
        data: { status: 'failed', error: (err as Error).message, completedAt: new Date() },
      });
    }
  }

  async republishPrFeedback(actor: WorkspaceActor, id: string) {
    const job = await this.prisma.scanJob.findUnique({ where: { id } });
    if (!job || !canViewResource(actor, job)) throw new NotFoundException(`Scan ${id} not found`);
    if (!job.prContext) throw new BadRequestException('This review was kept in the app, so there is nothing to post.');
    if (job.status !== 'completed') throw new BadRequestException('Wait for the review to finish before posting it.');
    return this.publishPrFeedback(id);
  }

  /**
   * Posts a finished PR/MR review back to GitHub/GitLab from what's stored,
   * and records whether that worked — so a refused comment (a fine-grained
   * token on someone else's repo, say) shows up in the report instead of
   * disappearing. Also behind the report's "Retry posting" button.
   */
  async publishPrFeedback(jobId: string): Promise<{ prPublishedAt: Date | null; prPublishError: string | null }> {
    const job = await this.prisma.scanJob.findUniqueOrThrow({ where: { id: jobId } });
    if (!job.prContext || job.status !== 'completed') {
      return { prPublishedAt: job.prPublishedAt, prPublishError: job.prPublishError };
    }
    const feedback = await this.buildPrFeedback(jobId, this.buildScanUrl(jobId));
    const outcome = await this.prFeedback.publish(job.userId, job.prContext as unknown as PrContext, feedback);
    const data = outcome.ok
      ? { prPublishedAt: new Date(), prPublishError: null }
      : { prPublishedAt: null, prPublishError: outcome.error };
    await this.prisma.scanJob.update({ where: { id: jobId }, data });
    return data;
  }

  /** A finished PR review as the feedback posted to the pull request, rebuilt from what's stored. */
  async buildPrFeedback(jobId: string, scanUrl?: string): Promise<PrFeedback> {
    const job = await this.prisma.scanJob.findUniqueOrThrow({ where: { id: jobId }, include: { files: true } });
    const snapshot = job.sourceType === 'github_pr' ? (job.prSnapshot as unknown as PrSnapshot | null) : null;
    const findings = job.files.flatMap((file) =>
      ((Array.isArray(file.findings) ? file.findings : []) as unknown as Finding[]).map((f) => ({
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
        confidence: f.confidence,
      })),
    );
    return {
      verdict: job.verdict ?? 'pass',
      summary: job.summary ?? '',
      findings,
      changedRanges: (job.changedRanges ?? undefined) as PrFeedback['changedRanges'],
      scanUrl,
      readiness: readinessForScan(job) ?? undefined,
      headSha: snapshot?.headSha,
      insights: (job.prInsights ?? undefined) as PrInsights | undefined,
      checks: snapshot
        ? deterministicChecks(snapshot, {
            findings,
            secrets: Array.isArray(job.secrets) ? job.secrets.length : 0,
            changedPaths: Object.keys((job.changedRanges ?? {}) as object),
          })
        : undefined,
      local: job.localOnly,
    };
  }

  private buildScanUrl(jobId: string): string | undefined {
    const origin = (this.config.get<string>('FRONTEND_ORIGIN') || '').split(',')[0]?.trim();
    return origin ? `${origin}/app/repository/${jobId}` : undefined;
  }

  async findOne(actor: WorkspaceActor & { role: 'user' | 'admin' | 'super_admin' }, id: string) {
    const job = await this.prisma.scanJob.findUnique({
      where: { id },
      include: { files: true },
    });
    if (!job || !canViewResource(actor, job)) throw new NotFoundException(`Scan ${id} not found`);

    // Computed on every read, not persisted — aggregateRisk is pure arithmetic
    // over data the scan already gathered, so there's nothing to invalidate
    // and no reason to pay a write for it. Only meaningful once the scan has
    // actually finished gathering that data.
    const riskAggregation = job.status === 'completed' ? aggregateRisk(job) : null;
    // The TDD assessment is the due diligence product — Enterprise only.
    const tddAssessment =
      riskAggregation && (await this.quota.canUseDueDiligence(actor.id, actor.role)) ? assessTdd(job, riskAggregation) : null;
    return { ...job, riskAggregation, tddAssessment, mergeReadiness: readinessForScan(job) };
  }

  async setFindingStatus(actor: WorkspaceActor, scanFileId: string, findingIndex: number, status: FindingStatus) {
    if (!FINDING_STATUSES.includes(status)) {
      throw new BadRequestException(`status must be one of: ${FINDING_STATUSES.join(', ')}`);
    }
    const file = await this.prisma.scanFile.findUnique({
      where: { id: scanFileId },
      include: { scanJob: true },
    });
    if (!file || !canViewResource(actor, file.scanJob)) throw new NotFoundException(`Scan file ${scanFileId} not found`);

    const findings = file.findings as unknown as unknown[];
    if (findingIndex < 0 || findingIndex >= findings.length) {
      throw new BadRequestException(`No finding at index ${findingIndex}`);
    }

    const statuses = { ...((file.findingStatuses as FindingStatuses | null) ?? {}) };
    if (status === 'open') delete statuses[findingIndex];
    else statuses[findingIndex] = status;

    return this.prisma.scanFile.update({
      where: { id: scanFileId },
      data: { findingStatuses: statuses as unknown as Prisma.InputJsonValue },
    });
  }

  async findRecent(actor: WorkspaceActor, limit = 20) {
    return this.prisma.scanJob.findMany({
      where: workspaceWhere(actor),
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
