import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GithubService } from '../github/github.service';
import { GitlabService } from '../gitlab/gitlab.service';
import { LlmService } from '../llm/llm.service';
import { RepositoryService } from '../repository/repository.service';

const BOT_MENTION = '@auditbench';
const MAX_CONTEXT_FILES = 5;
const MAX_CONTEXT_CHARS_PER_FILE = 2000;
const GITHUB_AUTO_REVIEW_ACTIONS = new Set(['opened', 'reopened', 'synchronize']);
const GITLAB_AUTO_REVIEW_ACTIONS = new Set(['open', 'reopen', 'update']);

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubService,
    private readonly gitlab: GitlabService,
    private readonly llm: LlmService,
    private readonly repository: RepositoryService,
  ) {}

  async listConfigs(userId: string) {
    return this.prisma.webhookConfig.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async createConfig(userId: string, provider: 'github' | 'gitlab', repoIdentifier: string, autoReview = true) {
    const existing = await this.prisma.webhookConfig.findUnique({
      where: { provider_repoIdentifier: { provider, repoIdentifier } },
    });
    if (existing) {
      throw new ConflictException(
        existing.userId === userId
          ? 'You already have a webhook configured for this repo'
          : 'This repo already has a webhook configured by another account',
      );
    }
    const secret = crypto.randomBytes(24).toString('hex');
    return this.prisma.webhookConfig.create({ data: { userId, provider, repoIdentifier, secret, autoReview } });
  }

  async updateConfig(userId: string, id: string, autoReview: boolean) {
    const config = await this.prisma.webhookConfig.findUnique({ where: { id } });
    if (!config || config.userId !== userId) throw new NotFoundException('Webhook config not found');
    return this.prisma.webhookConfig.update({ where: { id }, data: { autoReview } });
  }

  async deleteConfig(userId: string, id: string) {
    const config = await this.prisma.webhookConfig.findUnique({ where: { id } });
    if (!config || config.userId !== userId) throw new NotFoundException('Webhook config not found');
    await this.prisma.webhookConfig.delete({ where: { id } });
    return { deleted: true };
  }

  /** GitHub sends comment and PR events to the same URL — route each to its handler. */
  async handleGithubEvent(event: string, rawBody: Buffer, body: any, signatureHeader: string | undefined) {
    if (event === 'pull_request') {
      return this.handleGithubPullRequestEvent(rawBody, body, signatureHeader);
    }
    if (event !== 'issue_comment' || body?.action !== 'created' || !body?.issue?.pull_request) {
      return { ok: true, skipped: 'not a PR comment creation event' };
    }

    const repoIdentifier: string = body.repository.full_name;
    const config = await this.prisma.webhookConfig.findUnique({
      where: { provider_repoIdentifier: { provider: 'github', repoIdentifier } },
      include: { user: { select: { id: true, githubUsername: true } } },
    });
    if (!config) return { ok: true, skipped: 'no webhook configured for this repo' };

    if (!GithubService.verifyWebhookSignature(config.secret, rawBody, signatureHeader)) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    const commentBody: string = body.comment?.body || '';
    const commentAuthor: string = body.comment?.user?.login || '';
    if (commentAuthor && commentAuthor === config.user.githubUsername) {
      return { ok: true, skipped: 'ignoring our own comment' }; // avoid an infinite reply loop
    }
    if (!commentBody.toLowerCase().includes(BOT_MENTION)) {
      return { ok: true, skipped: 'no bot mention' };
    }

    const [owner, repo] = repoIdentifier.split('/');
    const pullNumber: number = body.issue.number;

    try {
      const { files } = await this.github.fetchPrFiles(config.userId, owner, repo, pullNumber);
      const reply = await this.generateReply(commentBody, files);
      await this.github.postIssueComment(config.userId, owner, repo, pullNumber, reply);
    } catch (err) {
      this.logger.error(`Failed to reply on ${repoIdentifier}#${pullNumber}`, err as Error);
    }
    return { ok: true };
  }

  /** This is what makes review "continuous" — no @-mention needed, fires on open/reopen/new commits. */
  private async handleGithubPullRequestEvent(rawBody: Buffer, body: any, signatureHeader: string | undefined) {
    const repoIdentifier: string = body?.repository?.full_name;
    const config = await this.prisma.webhookConfig.findUnique({
      where: { provider_repoIdentifier: { provider: 'github', repoIdentifier } },
      include: { user: { select: { id: true, organizationId: true } } },
    });
    if (!config) return { ok: true, skipped: 'no webhook configured for this repo' };

    if (!GithubService.verifyWebhookSignature(config.secret, rawBody, signatureHeader)) {
      throw new ForbiddenException('Invalid webhook signature');
    }
    if (!config.autoReview) return { ok: true, skipped: 'auto-review disabled for this repo' };
    if (!GITHUB_AUTO_REVIEW_ACTIONS.has(body?.action)) {
      return { ok: true, skipped: `action "${body?.action}" doesn't need a re-review` };
    }
    if (body?.pull_request?.draft) return { ok: true, skipped: 'draft PR' };

    const [owner, repo] = repoIdentifier.split('/');
    const pullNumber: number = body.pull_request.number;
    const headSha: string = body.pull_request.head?.sha;

    if (await this.alreadyReviewed('github_pr', `${repoIdentifier}#${pullNumber}`, headSha)) {
      return { ok: true, skipped: 'this commit was already reviewed' };
    }

    try {
      const { files, url, headSha: fetchedSha, headRef, baseRef } = await this.github.fetchPrFiles(
        config.userId,
        owner,
        repo,
        pullNumber,
      );
      await this.repository.createDiffReview({ id: config.userId, organizationId: config.user.organizationId }, files, {
        sourceName: `${owner}/${repo}#${pullNumber}`,
        sourceType: 'github_pr',
        pullRequestUrl: url,
        prContext: { kind: 'github', owner, repo, pullNumber, headSha: fetchedSha, headRef, baseRef },
      });
    } catch (err) {
      await this.handleAutoReviewError(err, () =>
        this.github.postIssueComment(
          config.userId,
          owner,
          repo,
          pullNumber,
          this.quotaSkipMessage(err as Error),
        ),
      );
    }
    return { ok: true };
  }

  /** GitLab sends note and MR events to the same URL — route each to its handler. */
  async handleGitlabEvent(event: string, body: any, tokenHeader: string | undefined) {
    if (event === 'Merge Request Hook') {
      return this.handleGitlabMergeRequestEvent(body, tokenHeader);
    }
    if (event !== 'Note Hook' || body?.object_attributes?.noteable_type !== 'MergeRequest') {
      return { ok: true, skipped: 'not an MR note event' };
    }

    const repoIdentifier: string = String(body.project.id);
    const config = await this.prisma.webhookConfig.findUnique({
      where: { provider_repoIdentifier: { provider: 'gitlab', repoIdentifier } },
      include: { user: { select: { id: true, gitlabUsername: true } } },
    });
    if (!config) return { ok: true, skipped: 'no webhook configured for this project' };

    if (!GitlabService.verifyWebhookToken(config.secret, tokenHeader)) {
      throw new ForbiddenException('Invalid webhook token');
    }

    const noteBody: string = body.object_attributes?.note || '';
    const noteAuthor: string = body.user?.username || '';
    if (noteAuthor && noteAuthor === config.user.gitlabUsername) {
      return { ok: true, skipped: 'ignoring our own note' };
    }
    if (!noteBody.toLowerCase().includes(BOT_MENTION)) {
      return { ok: true, skipped: 'no bot mention' };
    }

    const projectId: number = body.project.id;
    const mrIid: number = body.merge_request.iid;

    try {
      const { files } = await this.gitlab.fetchMrFiles(config.userId, projectId, mrIid);
      const reply = await this.generateReply(noteBody, files);
      await this.gitlab.postMrNote(config.userId, projectId, mrIid, reply);
    } catch (err) {
      this.logger.error(`Failed to reply on project ${projectId} MR !${mrIid}`, err as Error);
    }
    return { ok: true };
  }

  /** This is what makes review "continuous" — no @-mention needed, fires on open/reopen/new commits. */
  private async handleGitlabMergeRequestEvent(body: any, tokenHeader: string | undefined) {
    const projectId: number = body?.project?.id;
    const repoIdentifier: string = String(projectId);
    const config = await this.prisma.webhookConfig.findUnique({
      where: { provider_repoIdentifier: { provider: 'gitlab', repoIdentifier } },
      include: { user: { select: { id: true, organizationId: true } } },
    });
    if (!config) return { ok: true, skipped: 'no webhook configured for this project' };

    if (!GitlabService.verifyWebhookToken(config.secret, tokenHeader)) {
      throw new ForbiddenException('Invalid webhook token');
    }
    if (!config.autoReview) return { ok: true, skipped: 'auto-review disabled for this project' };

    const attrs = body?.object_attributes || {};
    if (!GITLAB_AUTO_REVIEW_ACTIONS.has(attrs.action)) {
      return { ok: true, skipped: `action "${attrs.action}" doesn't need a re-review` };
    }
    if (attrs.draft || attrs.work_in_progress) return { ok: true, skipped: 'draft MR' };
    if (attrs.state !== 'opened') return { ok: true, skipped: `state "${attrs.state}", not open` };

    const mrIid: number = attrs.iid;
    const headSha: string | undefined = attrs.last_commit?.id;

    if (await this.alreadyReviewed('gitlab_mr', `project ${projectId} !${mrIid}`, headSha)) {
      return { ok: true, skipped: 'this commit was already reviewed' };
    }

    try {
      const { files, url, headSha: fetchedSha, diffRefs, sourceBranch, targetBranch } =
        await this.gitlab.fetchMrFiles(config.userId, projectId, mrIid);
      await this.repository.createDiffReview({ id: config.userId, organizationId: config.user.organizationId }, files, {
        sourceName: `project ${projectId} !${mrIid}`,
        sourceType: 'gitlab_mr',
        pullRequestUrl: url,
        prContext: { kind: 'gitlab', projectId, mrIid, headSha: fetchedSha, diffRefs, sourceBranch, targetBranch },
      });
    } catch (err) {
      await this.handleAutoReviewError(err, () =>
        this.gitlab.postMrNote(config.userId, projectId, mrIid, this.quotaSkipMessage(err as Error)),
      );
    }
    return { ok: true };
  }

  /** Skips a re-review if the same commit sha was already scanned — GitHub/GitLab both redeliver events on retry. */
  private async alreadyReviewed(
    sourceType: 'github_pr' | 'gitlab_mr',
    sourceName: string,
    headSha: string | undefined,
  ): Promise<boolean> {
    if (!headSha) return false;
    const last = await this.prisma.scanJob.findFirst({
      where: { sourceType, sourceName },
      orderBy: { createdAt: 'desc' },
      select: { prContext: true },
    });
    return (last?.prContext as { headSha?: string } | null)?.headSha === headSha;
  }

  /** Quota/plan gates throw Forbidden (403) or a 429 HttpException — only those two are worth telling the author about. */
  private async handleAutoReviewError(err: unknown, postSkipComment: () => Promise<unknown>): Promise<void> {
    const isForbidden = err instanceof ForbiddenException;
    const isRateLimited = err instanceof HttpException && err.getStatus() === HttpStatus.TOO_MANY_REQUESTS;
    if (isForbidden || isRateLimited) {
      try {
        await postSkipComment();
      } catch (postErr) {
        this.logger.error('Failed to post auto-review skip comment', postErr as Error);
      }
      return;
    }
    this.logger.error('Auto-review failed', err as Error);
  }

  private quotaSkipMessage(err: Error): string {
    return `audit/bench skipped the automatic review of this commit: ${err.message}`;
  }

  private async generateReply(question: string, files: { path: string; content: string }[]): Promise<string> {
    const context = files
      .slice(0, MAX_CONTEXT_FILES)
      .map((f) => `--- ${f.path} ---\n${f.content.slice(0, MAX_CONTEXT_CHARS_PER_FILE)}`)
      .join('\n\n');

    const prompt = `You are audit/bench, a code review bot replying to a comment thread on a pull/merge request. Answer the question directly and concisely (a few sentences, or a short code snippet if helpful), referencing specific files/lines from the diff below where relevant. Don't repeat the question back.

Changed files in this PR/MR:
${context || '(no changed files available)'}

The reviewer asked:
${question.replace(new RegExp(BOT_MENTION, 'gi'), '').trim()}`;

    const providerName = this.llm.resolveProvider();
    return this.llm.completeText(providerName, prompt);
  }
}
