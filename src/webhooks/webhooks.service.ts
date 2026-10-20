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
import { GithubAuth, GithubService } from '../github/github.service';
import { GitlabService } from '../gitlab/gitlab.service';
import { LlmService } from '../llm/llm.service';
import { RepositoryService } from '../repository/repository.service';
import { QuotaService } from '../quota/quota.service';
import { FINDING_MARKER, parseFindingComment } from '../pr-feedback/inline-comment';
import { ReviewRulesService } from '../review-rules/review-rules.service';
import { BitbucketService } from '../bitbucket/bitbucket.service';
import {
  MAX_AGENT_REPLIES_PER_THREAD,
  buildRecheckPrompt,
  codeWindow,
  formatAgentReply,
  recheckSchema,
  settlesThread,
} from './thread-reply';

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
    private readonly quota: QuotaService,
    private readonly reviewRules: ReviewRulesService,
    private readonly bitbucket: BitbucketService,
  ) {}

  async listConfigs(userId: string) {
    return this.prisma.webhookConfig.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async createConfig(
    userId: string,
    provider: 'github' | 'gitlab' | 'bitbucket',
    repoIdentifier: string,
    autoReview = true,
  ) {
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
    if (event === 'pull_request_review_comment') {
      return this.handleGithubReviewCommentEvent(rawBody, body, signatureHeader);
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
    await this.answerMention(config.userId, owner, repo, body.issue.number, commentBody);
    return { ok: true };
  }

  /** Answers an @auditbench question in a PR conversation, as the user or the GitHub App. */
  async answerMention(auth: GithubAuth, owner: string, repo: string, pullNumber: number, question: string) {
    try {
      const { files } = await this.github.fetchPrFiles(auth, owner, repo, pullNumber);
      const reply = await this.generateReply(question, files);
      await this.github.postIssueComment(auth, owner, repo, pullNumber, reply);
    } catch (err) {
      this.logger.error(`Failed to reply on ${owner}/${repo}#${pullNumber}`, err as Error);
    }
  }

  /**
   * A reply inside one of Audit Bench Ai's inline threads (or a new inline
   * comment that mentions @auditbench): recheck the code at the PR's latest
   * commit and answer in the same thread, resolving it once the fix is in.
   * Comments post as the connected user's own account, so our own comments
   * are recognised by hidden markers rather than by author.
   */
  private async handleGithubReviewCommentEvent(rawBody: Buffer, body: any, signatureHeader: string | undefined) {
    if (body?.action !== 'created' || !body?.comment || !body?.pull_request) {
      return { ok: true, skipped: 'not a new review comment' };
    }
    const repoIdentifier: string = body.repository.full_name;
    const config = await this.prisma.webhookConfig.findUnique({
      where: { provider_repoIdentifier: { provider: 'github', repoIdentifier } },
    });
    if (!config) return { ok: true, skipped: 'no webhook configured for this repo' };
    if (!GithubService.verifyWebhookSignature(config.secret, rawBody, signatureHeader)) {
      throw new ForbiddenException('Invalid webhook signature');
    }

    return this.recheckThread(config.userId, config.userId, body);
  }

  /**
   * The reply agent's work for one new review comment: as `auth` (a user or
   * the GitHub App), on `quotaUserId`'s plan. Called after the caller has
   * verified the webhook.
   */
  async recheckThread(auth: GithubAuth, quotaUserId: string, body: any) {
    const repoIdentifier: string = body.repository.full_name;
    const comment = body.comment;
    const text: string = comment.body || '';
    if (text.includes('<!-- audit-bench')) return { ok: true, skipped: 'ignoring our own comment' };
    const mentioned = text.toLowerCase().includes(BOT_MENTION);
    const [owner, repo] = repoIdentifier.split('/');
    const pullNumber: number = body.pull_request.number;
    const headSha: string = body.pull_request.head.sha;
    const rootId: number = comment.in_reply_to_id ?? comment.id;

    try {
      const root = rootId === comment.id ? comment : await this.github.getReviewComment(auth, owner, repo, rootId);
      if (!String(root.body ?? '').includes(FINDING_MARKER) && !mentioned) {
        return { ok: true, skipped: 'not an Audit Bench Ai thread' };
      }
      const thread = await this.github.listReviewThread(auth, owner, repo, pullNumber, rootId);
      if (thread.filter((c) => c.body.includes('<!-- audit-bench:reply')).length >= MAX_AGENT_REPLIES_PER_THREAD) {
        return { ok: true, skipped: 'reply limit reached for this thread' };
      }

      try {
        await this.quota.assertCanRunAudit(quotaUserId);
      } catch (err) {
        await this.github.replyToReviewComment(
          auth,
          owner,
          repo,
          pullNumber,
          rootId,
          `<!-- audit-bench:reply -->\nAudit Bench Ai couldn't recheck this: ${(err as Error).message}`,
        );
        return { ok: true, skipped: 'quota' };
      }

      const outdated = root.line == null;
      const end: number = root.line ?? root.original_line ?? 1;
      const start: number = (outdated ? root.original_start_line : root.start_line) ?? end;
      const content = await this.github
        .getFileAtRef(auth, owner, repo, root.path, headSha)
        .then((f) => f.content)
        .catch((err: unknown) => {
          if (err instanceof NotFoundException) return null;
          throw err;
        });

      const prompt = buildRecheckPrompt({
        path: root.path,
        start,
        end,
        outdated,
        headSha,
        code: codeWindow(content, start, end, outdated),
        thread: thread.map((c) => ({
          author: c.user?.login ?? 'someone',
          body: c.body,
          fromAgent: c.body.includes('<!-- audit-bench'),
        })),
      });
      const { result } = await this.llm.completeStructured(this.llm.resolveProvider(), prompt, recheckSchema);
      const resolved = settlesThread(result.status)
        ? await this.github.resolveReviewThread(auth, owner, repo, pullNumber, rootId).catch(() => false)
        : false;
      await this.github.replyToReviewComment(
        auth,
        owner,
        repo,
        pullNumber,
        rootId,
        formatAgentReply(result, headSha, resolved),
      );
      // How the thread ended teaches the team's review rules.
      if (result.status === 'resolved' || result.status === 'not_an_issue') {
        const finding = parseFindingComment(root.body ?? '');
        if (finding) {
          await this.reviewRules.recordFeedback(await this.ownerOf(quotaUserId), {
            repo: repoIdentifier,
            path: root.path,
            category: finding.category,
            title: finding.title,
            signal: result.status,
            source: 'thread',
            sourceRef: `thread:${repoIdentifier}:${rootId}`,
          });
        }
      }
      return { ok: true, status: result.status };
    } catch (err) {
      this.logger.error(`Failed to recheck thread ${rootId} on ${repoIdentifier}#${pullNumber}`, err as Error);
      return { ok: true, skipped: 'error' };
    }
  }

  private async ownerOf(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, organizationId: true },
    });
    return { id: user.id, organizationId: user.organizationId };
  }

  /**
   * When a PR closes, reads the 👍/👎 on each of our inline comments into the
   * team's feedback. GitHub sends no event for reactions, so this is when
   * they're collected; re-running it doesn't double count.
   */
  async harvestReactions(auth: GithubAuth, ownerUserId: string, owner: string, repo: string, pullNumber: number) {
    try {
      const comments = await this.github.listPullReviewComments(auth, owner, repo, pullNumber);
      const team = await this.ownerOf(ownerUserId);
      for (const c of comments) {
        const finding = parseFindingComment(c.body ?? '');
        if (!finding) continue;
        const base = {
          repo: `${owner}/${repo}`,
          path: c.path,
          category: finding.category,
          title: finding.title,
          source: 'reaction',
        };
        if ((c.reactions?.['-1'] ?? 0) > 0) {
          await this.reviewRules.recordFeedback(team, { ...base, signal: 'down', sourceRef: `reaction:${c.id}:down` });
        }
        if ((c.reactions?.['+1'] ?? 0) > 0) {
          await this.reviewRules.recordFeedback(team, { ...base, signal: 'up', sourceRef: `reaction:${c.id}:up` });
        }
      }
    } catch (err) {
      this.logger.warn(`Couldn't collect reactions on ${owner}/${repo}#${pullNumber}: ${(err as Error).message}`);
    }
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
    if (body?.action === 'closed') {
      const [o, r] = repoIdentifier.split('/');
      await this.harvestReactions(config.userId, config.userId, o, r, body.pull_request.number);
      return { ok: true, status: 'feedback collected' };
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

    await this.autoReviewPullRequest(
      config.userId,
      { id: config.userId, organizationId: config.user.organizationId },
      owner,
      repo,
      pullNumber,
    );
    return { ok: true };
  }

  /**
   * Reviews a pull request's latest commit as `auth` (a user, or the GitHub
   * App with `installationId` so the review posts as its bot), on `actor`'s plan.
   */
  async autoReviewPullRequest(
    auth: GithubAuth,
    actor: { id: string; organizationId: string | null },
    owner: string,
    repo: string,
    pullNumber: number,
  ) {
    try {
      const { files, url, headSha, headRef, baseRef, snapshot, repoFiles } = await this.github.fetchPrFiles(
        auth,
        owner,
        repo,
        pullNumber,
        { withSnapshot: true, withRepoContext: true },
      );
      await this.repository.createDiffReview(
        actor,
        files,
        {
          sourceName: `${owner}/${repo}#${pullNumber}`,
          sourceType: 'github_pr',
          pullRequestUrl: url,
          prContext: {
            kind: 'github',
            owner,
            repo,
            pullNumber,
            headSha,
            headRef,
            baseRef,
            ...(typeof auth === 'string' ? {} : { installationId: auth.installationId }),
          },
        },
        { prSnapshot: snapshot, repoFiles },
      );
    } catch (err) {
      await this.handleAutoReviewError(err, () =>
        this.github.postIssueComment(auth, owner, repo, pullNumber, this.quotaSkipMessage(err as Error)),
      );
    }
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
      const {
        files,
        url,
        headSha: fetchedSha,
        diffRefs,
        sourceBranch,
        targetBranch,
      } = await this.gitlab.fetchMrFiles(config.userId, projectId, mrIid);
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
  async alreadyReviewed(
    sourceType: 'github_pr' | 'gitlab_mr' | 'bitbucket_pr',
    sourceName: string,
    headSha: string | undefined,
  ): Promise<boolean> {
    if (!headSha) return false;
    const last = await this.prisma.scanJob.findFirst({
      where: { sourceType, sourceName },
      orderBy: { createdAt: 'desc' },
      select: { prContext: true },
    });
    const stored = (last?.prContext as { headSha?: string } | null)?.headSha;
    // Bitbucket's webhooks carry 12-character hashes; a stored full one still matches.
    return Boolean(stored && headSha.length >= 7 && (stored === headSha || stored.startsWith(headSha)));
  }

  /** Bitbucket Cloud: auto-review on a new or updated pull request (no mention-chat yet). */
  async handleBitbucketEvent(event: string, rawBody: Buffer, body: any, signatureHeader: string | undefined) {
    const repoIdentifier: string = body?.repository?.full_name;
    if (!repoIdentifier) return { ok: true, skipped: 'no repository' };
    const config = await this.prisma.webhookConfig.findUnique({
      where: { provider_repoIdentifier: { provider: 'bitbucket', repoIdentifier } },
      include: { user: { select: { id: true, organizationId: true } } },
    });
    if (!config) return { ok: true, skipped: 'no webhook configured for this repo' };
    if (!BitbucketService.verifyWebhookSignature(config.secret, rawBody, signatureHeader)) {
      throw new ForbiddenException('Invalid webhook signature');
    }
    if (!config.autoReview) return { ok: true, skipped: 'auto-review disabled for this repo' };
    if (event !== 'pullrequest:created' && event !== 'pullrequest:updated') {
      return { ok: true, skipped: `event "${event}" doesn't need a review` };
    }
    const pr = body.pullrequest;
    if (!pr?.id || pr.draft) return { ok: true, skipped: 'draft or missing pull request' };
    const [workspace, repoSlug] = repoIdentifier.split('/');
    const sourceName = `${repoIdentifier}#${pr.id}`;
    if (await this.alreadyReviewed('bitbucket_pr', sourceName, pr.source?.commit?.hash)) {
      return { ok: true, skipped: 'this commit was already reviewed' };
    }
    void (async () => {
      try {
        const details = await this.bitbucket.fetchPrFiles(config.userId, workspace, repoSlug, pr.id);
        await this.repository.createDiffReview(
          { id: config.userId, organizationId: config.user.organizationId },
          details.files,
          {
            sourceName,
            sourceType: 'bitbucket_pr',
            pullRequestUrl: details.url,
            prContext: {
              kind: 'bitbucket',
              workspace,
              repoSlug,
              pullId: pr.id,
              headSha: details.headSha,
              sourceBranch: details.sourceBranch,
              destinationBranch: details.destinationBranch,
            },
          },
        );
      } catch (err) {
        this.logger.warn(`Bitbucket auto-review of ${sourceName} failed: ${(err as Error).message}`);
      }
    })();
    return { ok: true, status: 'reviewing' };
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
    return `Audit Bench Ai skipped the automatic review of this commit: ${err.message}`;
  }

  private async generateReply(question: string, files: { path: string; content: string }[]): Promise<string> {
    const context = files
      .slice(0, MAX_CONTEXT_FILES)
      .map((f) => `--- ${f.path} ---\n${f.content.slice(0, MAX_CONTEXT_CHARS_PER_FILE)}`)
      .join('\n\n');

    const prompt = `You are Audit Bench Ai, a code review bot replying to a comment thread on a pull/merge request. Answer the question directly and concisely (a few sentences, or a short code snippet if helpful), referencing specific files/lines from the diff below where relevant. Don't repeat the question back.

Changed files in this PR/MR:
${context || '(no changed files available)'}

The reviewer asked:
${question.replace(new RegExp(BOT_MENTION, 'gi'), '').trim()}`;

    const providerName = this.llm.resolveProvider();
    return this.llm.completeText(providerName, prompt);
  }
}
