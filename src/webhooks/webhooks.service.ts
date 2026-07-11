import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GithubService } from '../github/github.service';
import { GitlabService } from '../gitlab/gitlab.service';
import { LlmService } from '../llm/llm.service';

const BOT_MENTION = '@auditbench';
const MAX_CONTEXT_FILES = 5;
const MAX_CONTEXT_CHARS_PER_FILE = 2000;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly github: GithubService,
    private readonly gitlab: GitlabService,
    private readonly llm: LlmService,
  ) {}

  async listConfigs(userId: string) {
    return this.prisma.webhookConfig.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async createConfig(userId: string, provider: 'github' | 'gitlab', repoIdentifier: string) {
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
    return this.prisma.webhookConfig.create({ data: { userId, provider, repoIdentifier, secret } });
  }

  async deleteConfig(userId: string, id: string) {
    const config = await this.prisma.webhookConfig.findUnique({ where: { id } });
    if (!config || config.userId !== userId) throw new NotFoundException('Webhook config not found');
    await this.prisma.webhookConfig.delete({ where: { id } });
    return { deleted: true };
  }

  /** GitHub sends every comment event — we only act on a new PR comment that @-mentions the bot. */
  async handleGithubEvent(event: string, rawBody: Buffer, body: any, signatureHeader: string | undefined) {
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

  /** GitLab sends the shared secret verbatim in X-Gitlab-Token — no HMAC. */
  async handleGitlabEvent(event: string, body: any, tokenHeader: string | undefined) {
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
