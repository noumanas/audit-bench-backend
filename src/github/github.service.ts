import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GithubPrDetails, GithubPrFile, GithubRepoSummary } from './github.types';
import { parseChangedRanges } from '../common/diff-ranges';
import { PrFeedbackService } from '../pr-feedback/pr-feedback.service';
import { PrContext, PrFeedback, PrPublisher } from '../pr-feedback/pr-feedback.types';
import { TokenCryptoService } from '../common/token-crypto.service';

const GITHUB_API = 'https://api.github.com';

@Injectable()
export class GithubService implements OnModuleInit, PrPublisher {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prFeedback: PrFeedbackService,
    private readonly tokenCrypto: TokenCryptoService,
  ) {}

  onModuleInit() {
    this.prFeedback.register('github', this);
  }

  private authHeaders(token: string) {
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ai-code-auditor',
    };
  }

  private async requireToken(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.githubToken) {
      throw new BadRequestException('Connect a GitHub account first');
    }
    return this.tokenCrypto.decrypt(user.githubToken);
  }

  async connect(userId: string, token: string) {
    const res = await fetch(`${GITHUB_API}/user`, { headers: this.authHeaders(token) });
    if (!res.ok) {
      throw new BadRequestException(
        res.status === 401
          ? 'That GitHub token was rejected — check it has "repo" scope and hasn\'t expired'
          : `GitHub rejected the request (${res.status})`,
      );
    }
    const profile = await res.json();

    await this.prisma.user.update({
      where: { id: userId },
      data: { githubToken: this.tokenCrypto.encrypt(token), githubUsername: profile.login },
    });

    return { username: profile.login as string };
  }

  async disconnect(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { githubToken: null, githubUsername: null },
    });
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { connected: Boolean(user.githubToken), username: user.githubUsername };
  }

  async listRepos(userId: string): Promise<GithubRepoSummary[]> {
    const token = await this.requireToken(userId);

    const res = await fetch(`${GITHUB_API}/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member`, {
      headers: this.authHeaders(token),
    });
    if (!res.ok) {
      throw new BadRequestException(`GitHub rejected the request (${res.status}) — token may be invalid or expired`);
    }

    const repos = await res.json();
    return repos.map(
      (r: any): GithubRepoSummary => ({
        id: r.id,
        owner: r.owner.login,
        name: r.name,
        fullName: r.full_name,
        private: r.private,
        description: r.description,
        defaultBranch: r.default_branch,
        updatedAt: r.updated_at,
        htmlUrl: r.html_url,
      }),
    );
  }

  async listBranches(userId: string, owner: string, repo: string): Promise<string[]> {
    const token = await this.requireToken(userId);

    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/branches?per_page=100`, {
      headers: this.authHeaders(token),
    });
    if (res.status === 404) {
      throw new NotFoundException(`Repository ${owner}/${repo} not found or not accessible with this token`);
    }
    if (!res.ok) {
      throw new BadRequestException(`GitHub rejected the request (${res.status})`);
    }

    const branches: any[] = await res.json();
    return branches.map((b) => b.name as string);
  }

  async downloadRepoZip(userId: string, owner: string, repo: string, ref?: string): Promise<Buffer> {
    const token = await this.requireToken(userId);

    const path = ref ? `${owner}/${repo}/zipball/${ref}` : `${owner}/${repo}/zipball`;
    const res = await fetch(`${GITHUB_API}/repos/${path}`, { headers: this.authHeaders(token) });

    if (res.status === 404) {
      throw new NotFoundException(`Repository ${owner}/${repo} not found or not accessible with this token`);
    }
    if (!res.ok) {
      throw new BadRequestException(`GitHub rejected the download (${res.status})`);
    }

    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Fetches a PR's changed files plus their full content at the PR's head
   * commit, and the line ranges each file's diff actually touched — so a
   * PR review can scope itself to the diff instead of re-reading whole
   * files. Removed files and files GitHub didn't include a patch for
   * (binary, or too large) are skipped — nothing to review there.
   */
  async fetchPrFiles(userId: string, owner: string, repo: string, pullNumber: number): Promise<GithubPrDetails> {
    const token = await this.requireToken(userId);

    const prRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}`, {
      headers: this.authHeaders(token),
    });
    if (prRes.status === 404) {
      throw new NotFoundException(`PR #${pullNumber} not found in ${owner}/${repo}, or not accessible with this token`);
    }
    if (!prRes.ok) throw new BadRequestException(`GitHub rejected the request (${prRes.status})`);
    const pr = await prRes.json();
    const headSha: string = pr.head.sha;

    const filesRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100`, {
      headers: this.authHeaders(token),
    });
    if (!filesRes.ok) throw new BadRequestException(`GitHub rejected the request (${filesRes.status})`);
    const rawFiles: any[] = await filesRes.json();

    const files: GithubPrFile[] = [];
    for (const f of rawFiles) {
      if (f.status === 'removed' || !f.patch) continue;
      const content = await this.fetchFileContent(token, owner, repo, f.filename, headSha);
      if (content === null) continue;
      files.push({
        path: f.filename,
        content,
        changedRanges: parseChangedRanges(f.patch),
        status: f.status,
      });
    }

    return { files, headSha, url: pr.html_url, headRef: pr.head.ref, baseRef: pr.base.ref };
  }

  /** Repo metadata needed to resolve "the ref that was scanned" when none was explicitly given. */
  async getRepoMeta(userId: string, owner: string, repo: string): Promise<{ defaultBranch: string }> {
    const token = await this.requireToken(userId);
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers: this.authHeaders(token) });
    if (res.status === 404) throw new NotFoundException(`Repository ${owner}/${repo} not found or not accessible with this token`);
    if (!res.ok) throw new BadRequestException(`GitHub rejected the request (${res.status})`);
    const data = await res.json();
    return { defaultBranch: data.default_branch };
  }

  /** Fetches a single file's content and blob sha at a given ref — the sha is required to update it. */
  async getFileAtRef(userId: string, owner: string, repo: string, path: string, ref: string): Promise<{ content: string; sha: string }> {
    const token = await this.requireToken(userId);
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`, {
      headers: this.authHeaders(token),
    });
    if (res.status === 404) throw new NotFoundException(`${path} not found at ${ref}`);
    if (!res.ok) throw new BadRequestException(`GitHub rejected the request (${res.status})`);
    const data = await res.json();
    if (data.encoding !== 'base64' || typeof data.content !== 'string') {
      throw new BadRequestException('Unexpected content encoding from GitHub');
    }
    return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
  }

  async getBranchHeadSha(userId: string, owner: string, repo: string, branch: string): Promise<string> {
    const token = await this.requireToken(userId);
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, {
      headers: this.authHeaders(token),
    });
    if (!res.ok) throw new BadRequestException(`GitHub rejected resolving branch "${branch}" (${res.status})`);
    const data = await res.json();
    return data.object.sha;
  }

  async createBranch(userId: string, owner: string, repo: string, newBranch: string, fromSha: string): Promise<void> {
    const token = await this.requireToken(userId);
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: fromSha }),
    });
    if (!res.ok) throw new BadRequestException(`GitHub rejected creating branch "${newBranch}" (${res.status})`);
  }

  /** Commits a full-file content update to `branch`. `sha` must be the file's current blob sha on that branch. */
  async commitFileUpdate(
    userId: string,
    owner: string,
    repo: string,
    path: string,
    branch: string,
    content: string,
    message: string,
    sha: string,
  ): Promise<string> {
    const token = await this.requireToken(userId);
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${encodedPath}`, {
      method: 'PUT',
      headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, content: Buffer.from(content, 'utf8').toString('base64'), sha, branch }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new BadRequestException(`GitHub rejected the commit (${res.status})${body.message ? `: ${body.message}` : ''}`);
    }
    const data = await res.json();
    return data.commit?.html_url || '';
  }

  async createPullRequest(
    userId: string,
    owner: string,
    repo: string,
    title: string,
    head: string,
    base: string,
    body: string,
  ): Promise<{ url: string; number: number }> {
    const token = await this.requireToken(userId);
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls`, {
      method: 'POST',
      headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, head, base, body }),
    });
    if (!res.ok) {
      const respBody = await res.json().catch(() => ({}));
      throw new BadRequestException(`GitHub rejected creating the pull request (${res.status})${respBody.message ? `: ${respBody.message}` : ''}`);
    }
    const data = await res.json();
    return { url: data.html_url, number: data.number };
  }

  private async fetchFileContent(token: string, owner: string, repo: string, path: string, ref: string): Promise<string | null> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${encodedPath}?ref=${ref}`, {
      headers: this.authHeaders(token),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.encoding !== 'base64' || typeof data.content !== 'string') return null;
    return Buffer.from(data.content, 'base64').toString('utf8');
  }

  /** PrPublisher — posts the review (inline comments + summary) and the merge-blocking commit status. */
  async publish(userId: string, context: Extract<PrContext, { kind: 'github' }>, feedback: PrFeedback): Promise<void> {
    const token = await this.requireToken(userId);
    await this.postPrReview(token, context.owner, context.repo, context.pullNumber, context.headSha, feedback);
    await this.postCommitStatus(token, context.owner, context.repo, context.headSha, feedback);
  }

  private async postPrReview(
    token: string,
    owner: string,
    repo: string,
    pullNumber: number,
    headSha: string,
    feedback: PrFeedback,
  ): Promise<void> {
    const comments = feedback.findings
      .filter((f) => f.line !== null)
      .slice(0, 50) // GitHub review payloads get unreliable well past this
      .map((f) => ({
        path: f.path,
        line: f.line as number,
        body: `**${severityLabel(f.severity)} — ${f.title}**\n\n${f.description}`,
      }));

    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
      method: 'POST',
      headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commit_id: headSha,
        body: buildSummaryBody(feedback),
        event: 'COMMENT',
        comments,
      }),
    });

    if (!res.ok) {
      // A single out-of-diff line invalidates the whole batch — fall back to
      // a plain summary-only comment so the PR still gets *something* useful.
      await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
        method: 'POST',
        headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: buildSummaryBody(feedback) }),
      });
    }
  }

  private async postCommitStatus(token: string, owner: string, repo: string, sha: string, feedback: PrFeedback): Promise<void> {
    const { state, description } = commitStatusFor(feedback);
    await fetch(`${GITHUB_API}/repos/${owner}/${repo}/statuses/${sha}`, {
      method: 'POST',
      headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ state, description, context: 'audit/bench' }),
    });
  }

  /** Used by the webhook receiver to reply to an @-mention on a PR thread. */
  async postIssueComment(userId: string, owner: string, repo: string, issueNumber: number, body: string): Promise<void> {
    const token = await this.requireToken(userId);
    await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
  }

  /** GitHub signs webhook deliveries with `X-Hub-Signature-256: sha256=<hmac>` over the raw body. */
  static verifyWebhookSignature(secret: string, rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader?.startsWith('sha256=')) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const provided = signatureHeader.slice('sha256='.length);
    const expectedBuf = Buffer.from(expected, 'hex');
    const providedBuf = Buffer.from(provided, 'hex');
    return expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);
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
 * do_not_ship blocks merge under branch protection; needs_work is reported
 * (visible in the check + inline comments) but doesn't block, since most
 * findings at that severity are worth a human judgment call rather than a
 * hard gate.
 */
function commitStatusFor(feedback: PrFeedback): { state: 'success' | 'failure'; description: string } {
  if (feedback.verdict === 'do_not_ship') {
    return { state: 'failure', description: 'audit/bench found blocking issues — see review comments' };
  }
  if (feedback.verdict === 'needs_work') {
    return { state: 'success', description: 'audit/bench found issues worth reviewing' };
  }
  return { state: 'success', description: 'audit/bench found no issues' };
}
