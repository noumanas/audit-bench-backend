import { Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { ScannedFile } from '../analysis/types';
import { LlmProviderName } from '../common/types';
import { worstVerdict } from '../common/verdict';
import { Prisma, ScanSourceType } from '@prisma/client';
import { PrFeedbackService } from '../pr-feedback/pr-feedback.service';
import { PrContext, PrFeedback } from '../pr-feedback/pr-feedback.types';

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

interface JobDataBase {
  sourceName: string;
  sourceType: ScanSourceType;
  pullRequestUrl?: string;
  prContext?: Prisma.InputJsonValue;
  framework?: string | null;
  fileCount: number;
  dependencyGraph?: Prisma.InputJsonValue;
  circularImports?: Prisma.InputJsonValue;
  deadCode?: Prisma.InputJsonValue;
  duplicates?: Prisma.InputJsonValue;
  secrets?: Prisma.InputJsonValue;
  dependencyVulnerabilities?: Prisma.InputJsonValue;
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

  async createScanJob(userId: string, file: Express.Multer.File, provider?: string) {
    return this.createScanJobFromBuffer(userId, file.buffer, file.originalname, provider);
  }

  /** Shared by the zip-upload controller and the GitHub/GitLab repo-import flows. */
  async createScanJobFromBuffer(
    userId: string,
    zipBuffer: Buffer,
    sourceName: string,
    provider?: string,
    sourceType: ScanSourceType = 'zip',
  ) {
    await this.quota.assertPlanAllowsRepositoryScan(userId);

    const providerName = this.llm.resolveProvider(provider);
    const maxFileSize = this.config.get<number>('MAX_FILE_SIZE_BYTES') || 200_000;
    const maxScanFiles = this.config.get<number>('MAX_SCAN_FILES') || 40;

    const files = extractZip(zipBuffer, maxFileSize);
    const framework = detectFramework(files);
    const { graph, circular } = buildDependencyGraph(files);
    const deadCode = findDeadCode(files, graph);
    const duplicates = findDuplicates(files);
    const secrets = scanSecrets(files);
    const dependencyVulnerabilities = await auditDependencies(files);
    const filesToAnalyze = selectFilesToAnalyze(files, maxScanFiles);
    const repoContext = `Detected framework: ${framework || 'unknown'}. Repository has ${files.length} files total; ${filesToAnalyze.length} selected for review.`;

    const job = await this.gateAndCreateJob(userId, filesToAnalyze, providerName, {
      sourceName,
      sourceType,
      fileCount: files.length,
      framework,
      dependencyGraph: graph as unknown as Prisma.InputJsonValue,
      circularImports: circular as unknown as Prisma.InputJsonValue,
      deadCode: deadCode as unknown as Prisma.InputJsonValue,
      duplicates: duplicates as unknown as Prisma.InputJsonValue,
      secrets: secrets as unknown as Prisma.InputJsonValue,
      dependencyVulnerabilities: dependencyVulnerabilities as unknown as Prisma.InputJsonValue,
    });

    void this.processScan(job.id, filesToAnalyze, providerName, repoContext);
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
    userId: string,
    files: ScannedFile[],
    meta: {
      sourceName: string;
      sourceType: 'github_pr' | 'gitlab_mr';
      pullRequestUrl: string;
      provider?: string;
      /** Set so processScan can publish the review/summary/status back once the scan completes. */
      prContext?: PrContext;
    },
  ) {
    await this.quota.assertPlanAllowsRepositoryScan(userId);

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

    const job = await this.gateAndCreateJob(userId, analyzable, providerName, {
      sourceName: meta.sourceName,
      sourceType: meta.sourceType,
      pullRequestUrl: meta.pullRequestUrl,
      prContext: meta.prContext as unknown as Prisma.InputJsonValue,
      fileCount: analyzable.length,
      secrets: secrets as unknown as Prisma.InputJsonValue,
    });

    void this.processScan(job.id, analyzable, providerName, repoContext);
    return job;
  }

  private async gateAndCreateJob(
    userId: string,
    files: ScannedFile[],
    providerName: LlmProviderName,
    jobDataBase: JobDataBase,
  ) {
    // Cheap, local-only pre-check: will this job make at least one fresh
    // LLM call? Only then does it need a quota gate — a scan/review that
    // turns out entirely clean (or fully cache-hit) never touches quota,
    // and one that's already at its limit isn't blocked from attempting a
    // scan that might cost nothing. See QuotaService for the full rationale.
    const willInvokeAi = await this.anyFileNeedsFreshAiCall(files, providerName);
    const jobData = { userId, status: 'queued' as const, provider: providerName, ...jobDataBase };

    return willInvokeAi
      ? this.quota.withQuotaCheck(
          (db) => this.quota.assertCanRunAudit(userId, db),
          (db) => db.scanJob.create({ data: jobData }),
        )
      : this.prisma.scanJob.create({ data: jobData });
  }

  private async anyFileNeedsFreshAiCall(files: ScannedFile[], providerName: LlmProviderName): Promise<boolean> {
    for (const file of files) {
      const hash = this.cache.hashFor(file.content, providerName, [], file.changedRanges);
      if (await this.cache.exists(hash)) continue; // cached — no fresh call needed for this file
      const fullStage1 = await runStage1(file.content, file.path);
      const stage1 = file.changedRanges ? filterStage1ToRanges(fullStage1, file.changedRanges) : fullStage1;
      if (!stage1.clean) return true;
    }
    return false;
  }

  private async processScan(jobId: string, files: ScannedFile[], providerName: LlmProviderName, repoContext: string) {
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
              const { result, fromCache } = await this.pipeline.run({
                filename: file.path,
                language: detectLanguage(file.path),
                code: file.content,
                provider: providerName,
                repoContext,
                changedLineRanges: file.changedRanges,
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
              return { path: file.path, result };
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
        const feedback: PrFeedback = {
          verdict: overallVerdict,
          summary,
          findings: succeededByFile.flatMap(({ path, result }) =>
            result.findings.map((f) => ({
              path,
              line: f.line,
              severity: f.severity,
              title: f.title,
              description: f.description,
            })),
          ),
          scanUrl: this.buildScanUrl(jobId),
        };
        await this.prFeedback.publish(job.userId, job.prContext as unknown as PrContext, feedback);
      }
    } catch (err) {
      this.logger.error(`Scan ${jobId} failed`, err as Error);
      await this.prisma.scanJob.update({
        where: { id: jobId },
        data: { status: 'failed', error: (err as Error).message, completedAt: new Date() },
      });
    }
  }

  private buildScanUrl(jobId: string): string | undefined {
    const origin = (this.config.get<string>('FRONTEND_ORIGIN') || '').split(',')[0]?.trim();
    return origin ? `${origin}/app/repository/${jobId}` : undefined;
  }

  async findOne(userId: string, id: string) {
    const job = await this.prisma.scanJob.findUnique({
      where: { id },
      include: { files: true },
    });
    if (!job || job.userId !== userId) throw new NotFoundException(`Scan ${id} not found`);
    return job;
  }

  async findRecent(userId: string, limit = 20) {
    return this.prisma.scanJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}
