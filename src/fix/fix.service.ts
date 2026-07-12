import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GithubService } from '../github/github.service';
import { GitlabService } from '../gitlab/gitlab.service';
import { PipelineService } from '../audit/pipeline.service';
import { QuotaService } from '../quota/quota.service';
import { LlmService } from '../llm/llm.service';
import { PrContext } from '../pr-feedback/pr-feedback.types';
import { RepoRef } from '../common/repo-ref.types';
import { detectLanguage } from '../common/language';
import { worstVerdict } from '../common/verdict';
import { LlmProviderName } from '../common/types';
import { findingSchema } from '../common/finding.schema';
import { CommitFixResult, RecheckFixResult, AiFixResult } from './fix.types';
import { buildAiFixPrompt, aiFixResultSchema } from './ai-fix-prompt';
import { WorkspaceActor, canViewResource } from '../common/workspace-scope';

const DEFAULT_MESSAGE = (path: string) => `audit/bench: apply suggested fix for ${path}`;

@Injectable()
export class FixService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubService,
    private readonly gitlab: GitlabService,
    private readonly pipeline: PipelineService,
    private readonly quota: QuotaService,
    private readonly llm: LlmService,
  ) {}

  // Visibility follows the same team rule as the rest of the workspace
  // (see workspace-scope.ts) — but every git-provider call below still
  // authenticates as the ACTING user's own token, never a shared one, so a
  // teammate without repo access there fails naturally at GitHub/GitLab's
  // own permission layer rather than needing an extra check here.
  private async loadJob(actor: WorkspaceActor, scanJobId: string) {
    const job = await this.prisma.scanJob.findUnique({ where: { id: scanJobId } });
    if (!job || !canViewResource(actor, job)) throw new NotFoundException(`Scan ${scanJobId} not found`);
    return job;
  }

  async getFileContent(actor: WorkspaceActor, scanJobId: string, path: string): Promise<{ content: string }> {
    const userId = actor.id;
    const job = await this.loadJob(actor, scanJobId);
    const prContext = job.prContext as unknown as PrContext | null;
    const repoRef = job.repoRef as unknown as RepoRef | null;

    if (prContext?.kind === 'github') {
      const { content } = await this.github.getFileAtRef(userId, prContext.owner, prContext.repo, path, prContext.headRef);
      return { content };
    }
    if (prContext?.kind === 'gitlab') {
      const content = await this.gitlab.getFileAtRef(userId, prContext.projectId, path, prContext.sourceBranch);
      return { content };
    }
    if (repoRef?.kind === 'github') {
      const { content } = await this.github.getFileAtRef(userId, repoRef.owner, repoRef.repo, path, repoRef.ref);
      return { content };
    }
    if (repoRef?.kind === 'gitlab') {
      const content = await this.gitlab.getFileAtRef(userId, repoRef.projectId, path, repoRef.ref);
      return { content };
    }

    throw new BadRequestException(
      'This scan does not support fixing in the editor — only GitHub/GitLab repo scans and PR/MR reviews do (not .zip uploads).',
    );
  }

  async commitFix(actor: WorkspaceActor, scanJobId: string, path: string, content: string, message?: string): Promise<CommitFixResult> {
    const userId = actor.id;
    const job = await this.loadJob(actor, scanJobId);
    const prContext = job.prContext as unknown as PrContext | null;
    const repoRef = job.repoRef as unknown as RepoRef | null;
    const commitMessage = message?.trim() || DEFAULT_MESSAGE(path);

    // PR/MR review — an open PR/MR already exists, so the fix lands as a
    // new commit directly on its branch rather than opening a second one.
    if (prContext?.kind === 'github') {
      const { sha } = await this.github.getFileAtRef(userId, prContext.owner, prContext.repo, path, prContext.headRef);
      const commitUrl = await this.github.commitFileUpdate(
        userId,
        prContext.owner,
        prContext.repo,
        path,
        prContext.headRef,
        content,
        commitMessage,
        sha,
      );
      return { commitUrl, pullRequestUrl: job.pullRequestUrl ?? undefined, created: false };
    }
    if (prContext?.kind === 'gitlab') {
      const commitUrl = await this.gitlab.commitFile(
        userId,
        prContext.projectId,
        prContext.sourceBranch,
        path,
        content,
        commitMessage,
      );
      return { commitUrl, pullRequestUrl: job.pullRequestUrl ?? undefined, created: false };
    }

    // Repo scan — no PR/MR exists yet, so branch off the scanned ref, commit
    // the fix there, and open one.
    if (repoRef?.kind === 'github') {
      const newBranch = `audit-bench-fix-${scanJobId.slice(0, 8)}-${Date.now()}`;
      const baseSha = await this.github.getBranchHeadSha(userId, repoRef.owner, repoRef.repo, repoRef.ref);
      await this.github.createBranch(userId, repoRef.owner, repoRef.repo, newBranch, baseSha);
      const { sha } = await this.github.getFileAtRef(userId, repoRef.owner, repoRef.repo, path, newBranch);
      const commitUrl = await this.github.commitFileUpdate(
        userId,
        repoRef.owner,
        repoRef.repo,
        path,
        newBranch,
        content,
        commitMessage,
        sha,
      );
      const pr = await this.github.createPullRequest(
        userId,
        repoRef.owner,
        repoRef.repo,
        `audit/bench: fix ${path}`,
        newBranch,
        repoRef.ref,
        commitMessage,
      );
      return { commitUrl, pullRequestUrl: pr.url, created: true };
    }
    if (repoRef?.kind === 'gitlab') {
      const newBranch = `audit-bench-fix-${scanJobId.slice(0, 8)}-${Date.now()}`;
      const commitUrl = await this.gitlab.commitFile(
        userId,
        repoRef.projectId,
        newBranch,
        path,
        content,
        commitMessage,
        repoRef.ref,
      );
      const mr = await this.gitlab.createMergeRequest(
        userId,
        repoRef.projectId,
        newBranch,
        repoRef.ref,
        `audit/bench: fix ${path}`,
        commitMessage,
      );
      return { commitUrl, pullRequestUrl: mr.url, created: true };
    }

    throw new BadRequestException(
      'This scan does not support committing fixes — only GitHub/GitLab repo scans and PR/MR reviews do (not .zip uploads).',
    );
  }

  /**
   * Re-runs the same free-first, AI-on-flagged-only pipeline against the
   * content just committed, so the user can see whether the fix actually
   * resolved what was found — without waiting for (or paying for) a whole
   * new scan. Recorded as a real Audit row (same quota accounting as any
   * other single-file review) and folded back into this scan's own
   * ScanFile/verdict so the report reflects the recheck too.
   */
  async recheckFix(actor: WorkspaceActor, scanJobId: string, path: string, content: string): Promise<RecheckFixResult> {
    const userId = actor.id;
    const job = await this.loadJob(actor, scanJobId);
    const providerName = job.provider as LlmProviderName;
    const language = detectLanguage(path);

    const existingFile = await this.prisma.scanFile.findFirst({ where: { scanJobId, path } });
    const before = {
      verdict: existingFile?.verdict ?? null,
      findingsCount: Array.isArray(existingFile?.findings) ? (existingFile!.findings as unknown[]).length : 0,
    };

    const { result, fromCache } = await this.pipeline.run(
      { filename: path, language, code: content, provider: providerName },
      { beforeAiCall: () => this.quota.assertCanRunAudit(userId) },
    );

    const auditData = {
      userId,
      organizationId: actor.organizationId,
      filename: path,
      language,
      provider: providerName,
      verdict: result.verdict,
      summary: `Re-check after committing a fix for ${path} (from scan ${scanJobId}).`,
      findings: result.findings as unknown as Prisma.InputJsonValue,
      stage1: result.stage1 as unknown as Prisma.InputJsonValue,
      aiInvoked: result.aiInvoked,
      fromCache,
      codeSize: content.length,
    };

    const consumesQuota = !fromCache && result.aiInvoked;
    if (consumesQuota) {
      await this.quota.withQuotaCheck(
        (db) => this.quota.assertCanRunAudit(userId, db),
        (db) => db.audit.create({ data: auditData }),
      );
    } else {
      await this.prisma.audit.create({ data: auditData });
    }

    if (existingFile) {
      await this.prisma.scanFile.update({
        where: { id: existingFile.id },
        data: {
          verdict: result.verdict,
          findings: result.findings as unknown as Prisma.InputJsonValue,
          stage1: result.stage1 as unknown as Prisma.InputJsonValue,
          aiInvoked: result.aiInvoked,
          fromCache,
        },
      });

      const allFiles = await this.prisma.scanFile.findMany({ where: { scanJobId } });
      const overallVerdict = worstVerdict(allFiles.map((f) => f.verdict ?? 'pass'));
      await this.prisma.scanJob.update({ where: { id: scanJobId }, data: { verdict: overallVerdict } });
    }

    return {
      before,
      after: { verdict: result.verdict, findings: result.findings },
      resolved: result.findings.length === 0 || result.verdict === 'pass',
    };
  }

  /**
   * Applies ONE specific finding's fix via a direct LLM call, rather than
   * asking the user to hand-edit the suggested fix themselves — a paid-plan
   * feature gated the same way repo scanning itself is (see
   * QuotaService.assertPlanAllowsRepositoryScan). Returns the whole updated
   * file so the editor can be swapped over wholesale; nothing is committed
   * here — the user still reviews and hits "Commit fix" separately.
   */
  async aiFix(
    actor: WorkspaceActor,
    scanJobId: string,
    path: string,
    content: string,
    rawFinding: Record<string, unknown>,
  ): Promise<AiFixResult> {
    const job = await this.loadJob(actor, scanJobId);
    await this.quota.assertPlanAllowsRepositoryScan(actor.id);

    let finding;
    try {
      finding = findingSchema.parse(rawFinding);
    } catch {
      throw new BadRequestException('Invalid finding payload');
    }

    const providerName = job.provider as LlmProviderName;
    const language = detectLanguage(path);
    const prompt = buildAiFixPrompt({ filename: path, language: language ?? undefined, code: content, finding });

    const applyFix = async () => this.llm.completeStructured(providerName, prompt, aiFixResultSchema);

    const auditData = () => ({
      userId: actor.id,
      organizationId: actor.organizationId,
      filename: path,
      language,
      provider: providerName,
      verdict: 'pass' as const,
      summary: `AI-generated fix for "${finding.title}" in ${path} (scan ${scanJobId}).`,
      findings: [] as unknown as Prisma.InputJsonValue,
      stage1: Prisma.JsonNull,
      aiInvoked: true,
      fromCache: false,
      codeSize: content.length,
    });

    // Fail fast before spending the LLM call, then re-check atomically with
    // the row insert that actually records the usage — same two-step
    // pattern as AuditService.runAudit / RepositoryService.gateAndCreateJob.
    await this.quota.assertCanRunAudit(actor.id);
    const result = await applyFix();
    await this.quota.withQuotaCheck(
      (db) => this.quota.assertCanRunAudit(actor.id, db),
      (db) => db.audit.create({ data: auditData() }),
    );

    return result;
  }
}
