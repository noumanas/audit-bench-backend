import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { GitlabMrDetails, GitlabMrFile, GitlabProjectSummary } from './gitlab.types';
import { parseChangedRanges } from '../common/diff-ranges';
import { PrFeedbackService } from '../pr-feedback/pr-feedback.service';
import { PrContext, PrFeedback, PrPublisher } from '../pr-feedback/pr-feedback.types';

@Injectable()
export class GitlabService implements OnModuleInit, PrPublisher {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly prFeedback: PrFeedbackService,
  ) {}

  onModuleInit() {
    this.prFeedback.register('gitlab', this);
  }

  private baseUrl(): string {
    return this.config.get<string>('GITLAB_BASE_URL') || 'https://gitlab.com/api/v4';
  }

  private authHeaders(token: string) {
    return { 'PRIVATE-TOKEN': token, 'User-Agent': 'ai-code-auditor' };
  }

  private async requireToken(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.gitlabToken) {
      throw new BadRequestException('Connect a GitLab account first');
    }
    return user.gitlabToken;
  }

  async connect(userId: string, token: string) {
    const res = await fetch(`${this.baseUrl()}/user`, { headers: this.authHeaders(token) });
    if (!res.ok) {
      throw new BadRequestException(
        res.status === 401
          ? 'That GitLab token was rejected — check it has "read_api" (or "api") scope and hasn\'t expired'
          : `GitLab rejected the request (${res.status})`,
      );
    }
    const profile = await res.json();

    await this.prisma.user.update({
      where: { id: userId },
      data: { gitlabToken: token, gitlabUsername: profile.username },
    });

    return { username: profile.username as string };
  }

  async disconnect(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { gitlabToken: null, gitlabUsername: null },
    });
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { connected: Boolean(user.gitlabToken), username: user.gitlabUsername };
  }

  async listProjects(userId: string): Promise<GitlabProjectSummary[]> {
    const token = await this.requireToken(userId);

    const res = await fetch(`${this.baseUrl()}/projects?membership=true&per_page=100&order_by=last_activity_at&sort=desc`, {
      headers: this.authHeaders(token),
    });
    if (!res.ok) {
      throw new BadRequestException(`GitLab rejected the request (${res.status}) — token may be invalid or expired`);
    }

    const projects = await res.json();
    return projects.map(
      (p: any): GitlabProjectSummary => ({
        id: p.id,
        pathWithNamespace: p.path_with_namespace,
        name: p.name,
        private: p.visibility !== 'public',
        description: p.description,
        defaultBranch: p.default_branch,
        updatedAt: p.last_activity_at,
        webUrl: p.web_url,
      }),
    );
  }

  async listBranches(userId: string, projectId: number): Promise<string[]> {
    const token = await this.requireToken(userId);

    const res = await fetch(`${this.baseUrl()}/projects/${projectId}/repository/branches?per_page=100`, {
      headers: this.authHeaders(token),
    });
    if (res.status === 404) {
      throw new NotFoundException(`Project ${projectId} not found or not accessible with this token`);
    }
    if (!res.ok) {
      throw new BadRequestException(`GitLab rejected the request (${res.status})`);
    }

    const branches: any[] = await res.json();
    return branches.map((b) => b.name as string);
  }

  async downloadProjectZip(userId: string, projectId: number, ref?: string): Promise<Buffer> {
    const token = await this.requireToken(userId);

    const query = ref ? `?sha=${encodeURIComponent(ref)}` : '';
    const res = await fetch(`${this.baseUrl()}/projects/${projectId}/repository/archive.zip${query}`, {
      headers: this.authHeaders(token),
    });

    if (res.status === 404) {
      throw new NotFoundException(`Project ${projectId} not found or not accessible with this token`);
    }
    if (!res.ok) {
      throw new BadRequestException(`GitLab rejected the download (${res.status})`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Fetches an MR's changed files plus their full content at the MR's head
   * commit, and the line ranges each file's diff actually touched — same
   * diff-scoping idea as GithubService.fetchPrFiles.
   */
  async fetchMrFiles(userId: string, projectId: number, mrIid: number): Promise<GitlabMrDetails> {
    const token = await this.requireToken(userId);

    const res = await fetch(`${this.baseUrl()}/projects/${projectId}/merge_requests/${mrIid}/changes`, {
      headers: this.authHeaders(token),
    });
    if (res.status === 404) {
      throw new NotFoundException(`MR !${mrIid} not found in project ${projectId}, or not accessible with this token`);
    }
    if (!res.ok) throw new BadRequestException(`GitLab rejected the request (${res.status})`);
    const mr = await res.json();
    const headSha: string = mr.diff_refs?.head_sha;
    const diffRefs = {
      baseSha: mr.diff_refs?.base_sha,
      startSha: mr.diff_refs?.start_sha,
      headSha,
    };

    const files: GitlabMrFile[] = [];
    for (const c of mr.changes || []) {
      if (c.deleted_file || !c.diff) continue;
      const content = await this.fetchFileContent(token, projectId, c.new_path, headSha);
      if (content === null) continue;
      files.push({
        path: c.new_path,
        content,
        changedRanges: parseChangedRanges(c.diff),
        status: c.new_file ? 'added' : c.renamed_file ? 'renamed' : 'modified',
      });
    }

    return { files, headSha, url: mr.web_url, diffRefs };
  }

  private async fetchFileContent(token: string, projectId: number, path: string, ref: string): Promise<string | null> {
    const encodedPath = encodeURIComponent(path);
    const res = await fetch(
      `${this.baseUrl()}/projects/${projectId}/repository/files/${encodedPath}/raw?ref=${encodeURIComponent(ref)}`,
      { headers: this.authHeaders(token) },
    );
    if (!res.ok) return null;
    return res.text();
  }

  /** PrPublisher — posts inline discussions + a summary note, and the merge-blocking commit status. */
  async publish(userId: string, context: Extract<PrContext, { kind: 'gitlab' }>, feedback: PrFeedback): Promise<void> {
    const token = await this.requireToken(userId);
    await this.postMrDiscussions(token, context.projectId, context.mrIid, context.diffRefs, feedback);
    await this.postMrNoteWithToken(token, context.projectId, context.mrIid, buildSummaryBody(feedback));
    await this.postCommitStatus(token, context.projectId, context.headSha, feedback);
  }

  private async postMrDiscussions(
    token: string,
    projectId: number,
    mrIid: number,
    diffRefs: { baseSha: string; startSha: string; headSha: string },
    feedback: PrFeedback,
  ): Promise<void> {
    const inline = feedback.findings.filter((f) => f.line !== null).slice(0, 50);
    for (const f of inline) {
      const body = `**${severityLabel(f.severity)} — ${f.title}**\n\n${f.description}`;
      const res = await fetch(`${this.baseUrl()}/projects/${projectId}/merge_requests/${mrIid}/discussions`, {
        method: 'POST',
        headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body,
          position: {
            position_type: 'text',
            base_sha: diffRefs.baseSha,
            start_sha: diffRefs.startSha,
            head_sha: diffRefs.headSha,
            new_path: f.path,
            new_line: f.line,
          },
        }),
      });
      if (!res.ok) {
        // Line fell outside the diff GitLab knows about — post as a plain
        // MR-level note instead of silently dropping the finding.
        await this.postMrNoteWithToken(token, projectId, mrIid, body);
      }
    }
  }

  /** Used by the webhook receiver to reply to an @-mention on an MR thread. */
  async postMrNote(userId: string, projectId: number, mrIid: number, body: string): Promise<void> {
    const token = await this.requireToken(userId);
    await this.postMrNoteWithToken(token, projectId, mrIid, body);
  }

  private async postMrNoteWithToken(token: string, projectId: number, mrIid: number, body: string): Promise<void> {
    await fetch(`${this.baseUrl()}/projects/${projectId}/merge_requests/${mrIid}/notes`, {
      method: 'POST',
      headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
  }

  private async postCommitStatus(token: string, projectId: number, sha: string, feedback: PrFeedback): Promise<void> {
    const { state, description } = commitStatusFor(feedback);
    await fetch(`${this.baseUrl()}/projects/${projectId}/statuses/${sha}`, {
      method: 'POST',
      headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, description, name: 'audit/bench' }),
    });
  }

  /** GitLab sends the configured secret verbatim in `X-Gitlab-Token` — no HMAC, just a direct compare. */
  static verifyWebhookToken(secret: string, tokenHeader: string | undefined): boolean {
    if (!tokenHeader) return false;
    const secretBuf = Buffer.from(secret);
    const providedBuf = Buffer.from(tokenHeader);
    return secretBuf.length === providedBuf.length && crypto.timingSafeEqual(secretBuf, providedBuf);
  }
}

function severityLabel(severity: string): string {
  const icons: Record<string, string> = { critical: '🔴 Critical', high: '🟠 High', medium: '🟡 Medium', low: '🔵 Low' };
  return icons[severity] || severity;
}

function buildSummaryBody(feedback: PrFeedback): string {
  const verdictLabel = { pass: '✅ Pass', needs_work: '⚠️ Needs work', do_not_ship: '⛔ Do not ship' }[feedback.verdict];
  const counts = feedback.findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] || 0) + 1;
    return acc;
  }, {});
  const countLine = ['critical', 'high', 'medium', 'low']
    .filter((s) => counts[s])
    .map((s) => `${counts[s]} ${s}`)
    .join(', ');

  const lines = [
    `### audit/bench review — ${verdictLabel}`,
    '',
    feedback.summary,
    '',
    countLine ? `**Findings:** ${countLine}` : '_No findings — all clear._',
  ];
  if (feedback.scanUrl) lines.push('', `[View full report](${feedback.scanUrl})`);
  return lines.join('\n');
}

/**
 * GitLab commit-status "failed" blocks merge under a "pipeline must succeed"
 * MR setting; same do_not_ship-only-blocks reasoning as GithubService.
 */
function commitStatusFor(feedback: PrFeedback): { state: 'success' | 'failed'; description: string } {
  if (feedback.verdict === 'do_not_ship') {
    return { state: 'failed', description: 'audit/bench found blocking issues — see review comments' };
  }
  if (feedback.verdict === 'needs_work') {
    return { state: 'success', description: 'audit/bench found issues worth reviewing' };
  }
  return { state: 'success', description: 'audit/bench found no issues' };
}
