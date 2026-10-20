import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { gitHostRequestFailed } from '../common/git-host-errors';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { GithubPrDetails, GithubPrFile, GithubPrSummary, GithubRepoSummary } from './github.types';
import { parseChangedRanges } from '../common/diff-ranges';
import { PrFeedbackService } from '../pr-feedback/pr-feedback.service';
import { PrContext, PrFeedback, PrFeedbackFinding, PrPublisher, REVIEW_FOOTER } from '../pr-feedback/pr-feedback.types';
import { commentLines, inlineCommentBody } from '../pr-feedback/inline-comment';
import { TokenCryptoService } from '../common/token-crypto.service';
import { ContributorStat } from '../analysis/types';
import { buildSummaryBody } from '../pr-feedback/summary-comment';
import { GithubPull, fetchCiChecks, refetchIfMergeabilityPending, toPrSnapshot } from '../common/github-pr-snapshot';

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
      throw gitHostRequestFailed('GitHub', res.status);
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
      throw gitHostRequestFailed('GitHub', res.status);
    }

    const branches: any[] = await res.json();
    return branches.map((b) => b.name as string);
  }

  async listPullRequests(userId: string, owner: string, repo: string): Promise<GithubPrSummary[]> {
    const token = await this.requireToken(userId);

    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls?state=open&per_page=100`, {
      headers: this.authHeaders(token),
    });
    if (res.status === 404) {
      throw new NotFoundException(`Repository ${owner}/${repo} not found or not accessible with this token`);
    }
    if (!res.ok) {
      throw gitHostRequestFailed('GitHub', res.status);
    }

    const pulls: any[] = await res.json();
    return pulls.map(
      (p: any): GithubPrSummary => ({
        number: p.number,
        title: p.title,
        headRef: p.head.ref,
        baseRef: p.base.ref,
        draft: Boolean(p.draft),
        updatedAt: p.updated_at,
        htmlUrl: p.html_url,
      }),
    );
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
   * Aggregated per-contributor commit stats for the repo's whole history —
   * GitHub computes and caches this server-side (weekly commit activity per
   * author), so no local git clone or per-commit walk is needed here. Used
   * to flag talent/bus-factor concentration on a repo scan (see
   * RepositoryService), not on a PR/MR diff review.
   */
  async fetchContributorStats(userId: string, owner: string, repo: string): Promise<ContributorStat[]> {
    const token = await this.requireToken(userId);
    const raw = await this.requestContributorStats(token, owner, repo);
    return raw ? mapGithubContributorStats(raw) : [];
  }

  /**
   * GitHub computes contributor stats lazily — a repo with no cached stats
   * yet returns 202 while it works in the background (its own documented
   * behavior, not an error). Retried once after a short delay since this
   * runs inline in a scan request rather than a background job; still 202
   * (or empty/404) after that just means "no stats available yet."
   */
  private async requestContributorStats(token: string, owner: string, repo: string): Promise<unknown[] | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/stats/contributors`, {
        headers: this.authHeaders(token),
      });
      if (res.status === 202) {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        }
        return null;
      }
      if (!res.ok) return null; // best-effort — a scan shouldn't fail over missing contributor stats
      const body = await res.json();
      return Array.isArray(body) ? body : null;
    }
    return null;
  }

  /**
   * Fetches a PR's changed files plus their full content at the PR's head
   * commit, and the line ranges each file's diff actually touched — so a
   * PR review can scope itself to the diff instead of re-reading whole
   * files. Removed files and files GitHub didn't include a patch for
   * (binary, or too large) are skipped — nothing to review there.
   */
  async fetchPrFiles(
    userId: string,
    owner: string,
    repo: string,
    pullNumber: number,
    opts: { withSnapshot?: boolean } = {},
  ): Promise<GithubPrDetails> {
    const token = await this.requireToken(userId);

    const prRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}`, {
      headers: this.authHeaders(token),
    });
    if (prRes.status === 404) {
      throw new NotFoundException(`PR #${pullNumber} not found in ${owner}/${repo}, or not accessible with this token`);
    }
    if (!prRes.ok) throw new BadRequestException(`GitHub rejected the request (${prRes.status})`);
    let pr = (await prRes.json()) as GithubPull;
    if (opts.withSnapshot) pr = await refetchIfMergeabilityPending(pr, this.authHeaders(token), owner, repo, pullNumber);
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

    const snapshot = opts.withSnapshot
      ? toPrSnapshot(
          pr,
          owner,
          repo,
          pullNumber,
          await fetchCiChecks(this.authHeaders(token), owner, repo, headSha),
          files.length,
          rawFiles.length,
        )
      : undefined;
    return { files, headSha, url: pr.html_url, headRef: pr.head.ref, baseRef: pr.base.ref, snapshot };
  }

  /** Repo metadata needed to resolve "the ref that was scanned" when none was explicitly given. */
  async getRepoMeta(userId: string, owner: string, repo: string): Promise<{ defaultBranch: string }> {
    const token = await this.requireToken(userId);
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers: this.authHeaders(token) });
    if (res.status === 404) throw new NotFoundException(`Repository ${owner}/${repo} not found or not accessible with this token`);
    if (!res.ok) throw gitHostRequestFailed('GitHub', res.status);
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
    if (!res.ok) throw gitHostRequestFailed('GitHub', res.status);
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

  /**
   * Posts a review with a given token — Audit Bench Ai's own account, for a
   * free public review the PR's author asked for. No commit status: that
   * needs write access the account doesn't have on other people's repos.
   */
  async postReviewWithToken(
    token: string,
    owner: string,
    repo: string,
    pullNumber: number,
    headSha: string,
    feedback: PrFeedback,
  ): Promise<void> {
    await this.postPrReview(token, owner, repo, pullNumber, headSha, feedback);
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
      .map((f) => ({ f, at: commentLines(f, feedback.changedRanges?.[f.path]) }))
      .filter((c): c is { f: PrFeedbackFinding; at: { start: number; end: number } } => c.at !== null)
      .slice(0, 50) // GitHub review payloads get unreliable well past this
      .map(({ f, at }) => ({
        path: f.path,
        // A range shows as "Comment on lines +start to +end" with the code above it.
        ...(at.end > at.start ? { start_line: at.start, start_side: 'RIGHT' } : {}),
        line: at.end,
        side: 'RIGHT',
        body: inlineCommentBody(f),
      }));

    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, {
      method: 'POST',
      headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        commit_id: headSha,
        body: buildSummaryBody(feedback, { posted: comments.length, headSha }),
        event: 'COMMENT',
        comments,
      }),
    });

    if (res.ok) return;
    const reviewError = await githubErrorMessage(res);
    // A single out-of-diff line invalidates the whole batch — fall back to
    // a plain summary-only comment so the PR still gets *something* useful.
    const fallback = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
      method: 'POST',
      headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: buildSummaryBody(feedback, { posted: 0, headSha }) }),
    });
    if (fallback.ok) return;
    throw new Error(explainPostFailure(fallback.status, (await githubErrorMessage(fallback)) || reviewError));
  }

  private async postCommitStatus(token: string, owner: string, repo: string, sha: string, feedback: PrFeedback): Promise<void> {
    const { state, description } = commitStatusFor(feedback);
    await fetch(`${GITHUB_API}/repos/${owner}/${repo}/statuses/${sha}`, {
      method: 'POST',
      headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
      // Kept as the pre-rebrand name, not "Audit Bench Ai" — this is the
      // stable status-check identifier branch protection rules key off of;
      // renaming it would silently break any required-check rule an
      // existing user already configured against "audit/bench".
      body: JSON.stringify({ state, description, context: 'audit/bench' }),
    });
  }

  /** Whether the user's own connected token can push to the repository (a maintainer, not just a reader). */
  async canPushTo(userId: string, owner: string, repo: string): Promise<boolean> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.githubToken) return false;
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      headers: this.authHeaders(this.tokenCrypto.decrypt(user.githubToken)),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { permissions?: { push?: boolean; maintain?: boolean; admin?: boolean } };
    return Boolean(body.permissions?.push || body.permissions?.maintain || body.permissions?.admin);
  }

  /** One inline review comment. */
  async getReviewComment(userId: string, owner: string, repo: string, commentId: number): Promise<GithubReviewComment> {
    const token = await this.requireToken(userId);
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/comments/${commentId}`, {
      headers: this.authHeaders(token),
    });
    if (!res.ok) throw gitHostRequestFailed('GitHub', res.status);
    return (await res.json()) as GithubReviewComment;
  }

  /** Every comment in one inline thread — the root and its replies — oldest first. */
  async listReviewThread(
    userId: string,
    owner: string,
    repo: string,
    pullNumber: number,
    rootId: number,
  ): Promise<GithubReviewComment[]> {
    const token = await this.requireToken(userId);
    const thread: GithubReviewComment[] = [];
    for (let page = 1; page <= 5; page++) {
      const res = await fetch(
        `${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/comments?per_page=100&page=${page}`,
        { headers: this.authHeaders(token) },
      );
      if (!res.ok) throw gitHostRequestFailed('GitHub', res.status);
      const batch = (await res.json()) as GithubReviewComment[];
      thread.push(...batch.filter((c) => c.id === rootId || c.in_reply_to_id === rootId));
      if (batch.length < 100) break;
    }
    return thread.sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  /** Answers inside an inline thread, under its root comment. */
  async replyToReviewComment(
    userId: string,
    owner: string,
    repo: string,
    pullNumber: number,
    rootId: number,
    body: string,
  ): Promise<void> {
    const token = await this.requireToken(userId);
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${pullNumber}/comments/${rootId}/replies`, {
      method: 'POST',
      headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    if (!res.ok) throw gitHostRequestFailed('GitHub', res.status);
  }

  /**
   * Marks the thread rooted at `rootId` resolved. Only GitHub's GraphQL API
   * can do this. Best effort: it needs write access to the repository, so on
   * a repo the user doesn't own the thread simply stays open.
   */
  async resolveReviewThread(userId: string, owner: string, repo: string, pullNumber: number, rootId: number): Promise<boolean> {
    const token = await this.requireToken(userId);
    const graphql = async (query: string, variables: Record<string, unknown>) => {
      const res = await fetch(`${GITHUB_API}/graphql`, {
        method: 'POST',
        headers: { ...this.authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      return res.ok ? ((await res.json()) as { data?: any; errors?: unknown[] }) : { errors: [res.status] };
    };
    const found = await graphql(
      `query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) { pullRequest(number: $number) {
          reviewThreads(first: 100) { nodes { id isResolved comments(first: 1) { nodes { databaseId } } } }
        } }
      }`,
      { owner, repo, number: pullNumber },
    );
    const threads: Array<{ id: string; isResolved: boolean; comments: { nodes: Array<{ databaseId: number }> } }> =
      found.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    const thread = threads.find((t) => t.comments.nodes[0]?.databaseId === rootId);
    if (!thread) return false;
    if (thread.isResolved) return true;
    const done = await graphql(
      `mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { isResolved } } }`,
      { id: thread.id },
    );
    return Boolean(done.data?.resolveReviewThread?.thread?.isResolved);
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

/**
 * Pure mapping from GitHub's `/stats/contributors` response shape into
 * ContributorStat[] — exported standalone so the mapping logic (weekly
 * bucket summing, last-active-week lookup) is unit-testable without a live
 * token/HTTP call. `author` is null on GitHub's side when a commit's email
 * doesn't match any GitHub account; those are grouped under 'unknown'
 * rather than dropped, since the commits/lines still count toward risk.
 */
export function mapGithubContributorStats(raw: unknown[]): ContributorStat[] {
  return raw
    .filter((entry): entry is Record<string, any> => Boolean(entry) && typeof (entry as any).total === 'number')
    .map((entry): ContributorStat => {
      const weeks: Array<{ w: number; a: number; d: number; c: number }> = Array.isArray(entry.weeks) ? entry.weeks : [];
      const additions = weeks.reduce((sum, w) => sum + (w.a || 0), 0);
      const deletions = weeks.reduce((sum, w) => sum + (w.d || 0), 0);
      const lastActiveWeek = [...weeks].reverse().find((w) => (w.c || 0) > 0);
      return {
        author: entry.author?.login || 'unknown',
        commits: entry.total,
        additions,
        deletions,
        lastCommitAt: lastActiveWeek ? new Date(lastActiveWeek.w * 1000).toISOString() : null,
      };
    })
    .sort((a, b) => b.commits - a.commits);
}


async function githubErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string };
    return body.message ?? '';
  } catch {
    return '';
  }
}

/** Turns GitHub's refusal into what the user should do about it. */
export function explainPostFailure(status: number, message: string): string {
  const base = `GitHub refused the comment (${status}${message ? `: ${message}` : ''}).`;
  if (/personal access token/i.test(message)) {
    return `${base} Fine-grained tokens can only comment on repositories they were granted access to. To comment on other people's public repositories, reconnect GitHub with a classic token that has the public_repo scope.`;
  }
  if (status === 401) return `${base} The GitHub token has expired or been revoked; reconnect GitHub with a new token.`;
  if (status === 403 && /locked|limited/i.test(message)) return `${base} The conversation is locked or limited to collaborators.`;
  if (status === 403 || status === 404) {
    return `${base} The token can't write to this repository. Check its scopes (repo or public_repo) and that it can access the repository.`;
  }
  return base;
}

/**
 * do_not_ship blocks merge under branch protection; needs_work is reported
 * (visible in the check + inline comments) but doesn't block, since most
 * findings at that severity are worth a human judgment call rather than a
 * hard gate.
 */
function commitStatusFor(feedback: PrFeedback): { state: 'success' | 'failure'; description: string } {
  if (feedback.verdict === 'do_not_ship') {
    return { state: 'failure', description: 'Audit Bench Ai found blocking issues — see review comments' };
  }
  if (feedback.verdict === 'needs_work') {
    return { state: 'success', description: 'Audit Bench Ai found issues worth reviewing' };
  }
  return { state: 'success', description: 'Audit Bench Ai found no issues' };
}

/** The parts of an inline review comment the reply agent reads. */
export interface GithubReviewComment {
  id: number;
  in_reply_to_id?: number;
  body: string;
  path: string;
  /** Null once the commented lines changed in a later push ("outdated"). */
  line: number | null;
  start_line: number | null;
  original_line: number | null;
  original_start_line: number | null;
  created_at: string;
  user: { login: string } | null;
}

export { buildSummaryBody };
