import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { GithubService } from '../github/github.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RepositoryService } from '../repository/repository.service';
import { aggregateRisk } from '../repository/risk-aggregation';
import { mapGithubContributorStats } from '../github/github.service';
import { WorkspaceActor, canViewResource } from '../common/workspace-scope';
import { parseGithubPrUrl, parseGithubRepoUrl } from '../common/github-url';
import { parseChangedRanges } from '../common/diff-ranges';
import { ANALYZABLE_EXTENSIONS } from '../common/language';
import { ScannedFile } from '../analysis/types';
import { PrSnapshot, readinessForScan } from '../common/merge-readiness';
import { GithubPull, fetchCiChecks, refetchIfMergeabilityPending, toPrSnapshot } from '../common/github-pr-snapshot';

const GITHUB_API = 'https://api.github.com';
const SYSTEM_EMAIL = 'public-scans@system.auditbenchai.local';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** GitHub reports repo size in KB. Bigger repos take too long for a free scan. */
const MAX_REPO_KB = 250 * 1024;
/** Changed files read for a free PR review — one page of GitHub's files list. */
const MAX_PR_FILES = 40;
const MAX_PR_FILE_BYTES = 200_000;

/**
 * Free, anonymous scans of public GitHub repositories from the marketing
 * site, plus the public share view used for those and for any scan its owner
 * chooses to share.
 *
 * Cost and abuse controls: local checks only (never an AI call), per-visitor
 * and site-wide daily caps, and a 24-hour reuse of an earlier scan of the
 * same repo and branch.
 */
@Injectable()
export class PublicScanService {
  private readonly logger = new Logger(PublicScanService.name);
  private systemUserId: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repositories: RepositoryService,
    private readonly config: ConfigService,
    private readonly github: GithubService,
  ) {}

  private githubHeaders(): Record<string, string> {
    // Optional server token: lifts GitHub's 60 requests/hour limit for
    // unauthenticated calls. Only ever used against public repositories.
    const token = this.config.get<string>('GITHUB_PUBLIC_TOKEN');
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'audit-bench-public-scan',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  /** Anonymous scans are owned by one locked system account (isActive false, no password, can't sign in). */
  private async systemActor(): Promise<WorkspaceActor> {
    if (!this.systemUserId) {
      const free = await this.prisma.plan.findUniqueOrThrow({ where: { slug: 'free' } });
      const user = await this.prisma.user.upsert({
        where: { email: SYSTEM_EMAIL },
        update: {},
        create: { email: SYSTEM_EMAIL, name: 'Public scans (anonymous)', planId: free.id, isActive: false },
      });
      this.systemUserId = user.id;
    }
    return { id: this.systemUserId, organizationId: null };
  }

  private hashIp(ip: string): string {
    return crypto.createHash('sha256').update(`public-scan:${ip}`).digest('hex');
  }

  async startScan(repoUrl: string, ip: string): Promise<{ shareId: string; reused: boolean }> {
    const pr = parseGithubPrUrl(repoUrl);
    if (pr) return this.startPrReview(pr.owner, pr.repo, pr.number, ip);
    const parsed = parseGithubRepoUrl(repoUrl);
    if (!parsed) {
      throw new BadRequestException(
        'Enter a public GitHub repository or pull request, like https://github.com/owner/repo/pull/123',
      );
    }
    let { owner, repo } = parsed;

    const metaRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers: this.githubHeaders() });
    if (metaRes.status === 404) {
      throw new NotFoundException(
        `We couldn't find ${owner}/${repo}. It may be private. Sign up free to scan private repositories.`,
      );
    }
    if (metaRes.status === 403 || metaRes.status === 429) {
      throw new HttpException('GitHub is rate-limiting us right now. Please try again in a few minutes.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (!metaRes.ok) throw new BadRequestException(`GitHub rejected the request (${metaRes.status})`);
    const meta = (await metaRes.json()) as { private: boolean; default_branch: string; size: number; full_name: string };
    if (meta.private) {
      throw new ForbiddenException('That repository is private. Sign up free to scan private repositories.');
    }
    if (meta.size > MAX_REPO_KB) {
      throw new BadRequestException('That repository is too large for a free scan. Sign up to scan it in full.');
    }
    const ref = parsed.ref || meta.default_branch;
    // GitHub redirects renamed or transferred repos; use the canonical name everywhere.
    const sourceName = meta.full_name || `${owner}/${repo}`;
    [owner, repo] = sourceName.split('/');

    // Same repo and branch scanned in the last day: share that result.
    const recent = await this.prisma.scanJob.findFirst({
      where: {
        sourceName,
        localOnly: true,
        isPublic: true,
        status: { not: 'failed' },
        createdAt: { gte: new Date(Date.now() - DAY_MS) },
        repoRef: { path: ['ref'], equals: ref },
      },
      orderBy: { createdAt: 'desc' },
      select: { shareId: true },
    });
    if (recent?.shareId) return { shareId: recent.shareId, reused: true };

    const ipHash = await this.assertWithinLimits(ip);

    const zipRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/zipball/${encodeURIComponent(ref)}`, {
      headers: this.githubHeaders(),
    });
    if (zipRes.status === 404) throw new NotFoundException(`Branch "${ref}" wasn't found in ${sourceName}.`);
    if (!zipRes.ok) throw new BadRequestException(`GitHub rejected the download (${zipRes.status})`);
    const zip = Buffer.from(await zipRes.arrayBuffer());
    const contributorStats = await this.contributorStats(owner, repo);

    const shareId = crypto.randomBytes(9).toString('base64url');
    await this.repositories.createScanJobFromBuffer(
      await this.systemActor(),
      zip,
      sourceName,
      undefined,
      'github_repo',
      { kind: 'github', owner, repo, ref, defaultBranch: meta.default_branch },
      contributorStats,
      { skipQuota: true, localOnly: true, isPublic: true, shareId, requesterIpHash: ipHash },
    );
    this.logger.log(`Public scan started for ${sourceName}@${ref} (${shareId})`);
    return { shareId, reused: false };
  }

  /**
   * Posts a free public PR review on the pull request as Audit Bench Ai's
   * own GitHub account (GITHUB_BOT_TOKEN). Only for the PR's author or a
   * maintainer, verified through their GitHub-linked account: letting any
   * visitor make the account comment on strangers' PRs would be spam, and
   * GitHub suspends accounts for it. At most one post per PR per day.
   */
  async postToPullRequest(actor: { id: string }, shareId: string): Promise<{ prPublishedAt: Date; url: string }> {
    const botToken = this.config.get<string>('GITHUB_BOT_TOKEN');
    if (!botToken) throw new ServiceUnavailableException("Posting as Audit Bench Ai isn't set up yet.");

    const job = await this.prisma.scanJob.findUnique({ where: { shareId } });
    if (!job || !job.isPublic || job.sourceType !== 'github_pr' || !job.prSnapshot) {
      throw new NotFoundException('This pull request review was not found.');
    }
    if (job.status !== 'completed') throw new BadRequestException('Wait for the review to finish before posting it.');
    if (job.prPublishedAt) throw new ConflictException('This review is already posted on the pull request.');
    const recentPost = await this.prisma.scanJob.findFirst({
      where: { sourceName: job.sourceName, sourceType: 'github_pr', prPublishedAt: { gte: new Date(Date.now() - DAY_MS) } },
      select: { id: true },
    });
    if (recentPost) throw new ConflictException('Audit Bench Ai already posted a review on this pull request today.');

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id }, select: { githubUsername: true } });
    if (!user.githubUsername) {
      throw new ForbiddenException(
        'Connect GitHub (or sign in with GitHub) first, so we can check that you wrote or maintain this pull request.',
      );
    }

    const snap = job.prSnapshot as unknown as PrSnapshot;
    const prRes = await fetch(`${GITHUB_API}/repos/${snap.owner}/${snap.repo}/pulls/${snap.number}`, {
      headers: this.githubHeaders(),
    });
    if (!prRes.ok) throw new BadRequestException(`GitHub rejected the request (${prRes.status})`);
    const pr = (await prRes.json()) as GithubPull & { user: { login: string } | null };
    if (pr.state !== 'open') {
      throw new BadRequestException(`This pull request is already ${pr.merged ? 'merged' : 'closed'}, so a review wouldn't help.`);
    }
    const isAuthor = pr.user?.login.toLowerCase() === user.githubUsername.toLowerCase();
    if (!isAuthor && !(await this.github.canPushTo(actor.id, snap.owner, snap.repo))) {
      throw new ForbiddenException(
        `Only the pull request's author${pr.user ? ` (@${pr.user.login})` : ''} or a maintainer of ${snap.owner}/${snap.repo} can ask Audit Bench Ai to post there. You're signed in as @${user.githubUsername}. You can still copy the comment and post it yourself.`,
      );
    }

    const origin = (this.config.get<string>('FRONTEND_ORIGIN') || '').split(',')[0]?.trim();
    const feedback = await this.repositories.buildPrFeedback(job.id, origin ? `${origin}/scan/${shareId}` : undefined);
    feedback.requestedBy = user.githubUsername;
    try {
      await this.github.postReviewWithToken(botToken, snap.owner, snap.repo, snap.number, snap.headSha, feedback);
    } catch (err) {
      const message = (err as Error).message || 'Posting the review failed.';
      await this.prisma.scanJob.update({ where: { id: job.id }, data: { prPublishError: message } });
      throw new BadRequestException(message);
    }
    const prPublishedAt = new Date();
    await this.prisma.scanJob.update({ where: { id: job.id }, data: { prPublishedAt, prPublishError: null } });
    this.logger.log(`Posted public review ${shareId} on ${job.sourceName} for @${user.githubUsername}`);
    return { prPublishedAt, url: pr.html_url };
  }

  /** Per-visitor hourly and site-wide daily caps, shared by repo scans and PR reviews. Returns the IP hash to store. */
  private async assertWithinLimits(ip: string): Promise<string> {
    const ipHash = this.hashIp(ip);
    const perVisitor = this.config.get<number>('PUBLIC_SCAN_PER_HOUR') || 3;
    const perDay = this.config.get<number>('PUBLIC_SCAN_DAILY_LIMIT') || 100;
    const [mine, total] = await Promise.all([
      this.prisma.scanJob.count({ where: { requesterIpHash: ipHash, createdAt: { gte: new Date(Date.now() - HOUR_MS) } } }),
      this.prisma.scanJob.count({ where: { requesterIpHash: { not: null }, createdAt: { gte: new Date(Date.now() - DAY_MS) } } }),
    ]);
    if (mine >= perVisitor) {
      throw new HttpException(
        `You've run ${perVisitor} free scans in the last hour. Sign up free for more scans and AI review.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (total >= perDay) {
      throw new HttpException(
        "We've hit today's limit for free public scans. Sign up free to scan now, or try again tomorrow.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return ipHash;
  }

  /**
   * Free review of a public pull request: local checks on the changed lines
   * only (never an AI call), plus GitHub's own view of whether it can merge —
   * conflicts, draft state and CI checks. Read-only: nothing is ever posted
   * back to the PR (no prContext), so a visitor can't make us comment on
   * someone else's repository. The share page offers the review as a comment
   * the visitor can post themselves.
   */
  async startPrReview(owner: string, repo: string, number: number, ip: string): Promise<{ shareId: string; reused: boolean }> {
    const prRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${number}`, { headers: this.githubHeaders() });
    if (prRes.status === 404) {
      throw new NotFoundException(
        `We couldn't find pull request #${number} in ${owner}/${repo}. It may be private. Sign up free to review private PRs.`,
      );
    }
    if (prRes.status === 403 || prRes.status === 429) {
      throw new HttpException('GitHub is rate-limiting us right now. Please try again in a few minutes.', HttpStatus.SERVICE_UNAVAILABLE);
    }
    if (!prRes.ok) throw new BadRequestException(`GitHub rejected the request (${prRes.status})`);
    let pr = (await prRes.json()) as GithubPull;
    if (pr.base.repo.private) {
      throw new ForbiddenException('That repository is private. Sign up free to review private pull requests.');
    }
    const sourceName = `${pr.base.repo.full_name}#${number}`;
    [owner, repo] = pr.base.repo.full_name.split('/');

    // Same PR at the same head commit reviewed in the last day: share that result.
    const recent = await this.prisma.scanJob.findFirst({
      where: {
        sourceName,
        sourceType: 'github_pr',
        localOnly: true,
        isPublic: true,
        status: { not: 'failed' },
        createdAt: { gte: new Date(Date.now() - DAY_MS) },
        prSnapshot: { path: ['headSha'], equals: pr.head.sha },
      },
      orderBy: { createdAt: 'desc' },
      select: { shareId: true },
    });
    if (recent?.shareId) return { shareId: recent.shareId, reused: true };

    const ipHash = await this.assertWithinLimits(ip);

    pr = await refetchIfMergeabilityPending(pr, this.githubHeaders(), owner, repo, number);

    const filesRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`, {
      headers: this.githubHeaders(),
    });
    if (!filesRes.ok) throw new BadRequestException(`GitHub rejected the request (${filesRes.status})`);
    const changed = (await filesRes.json()) as Array<{ filename: string; status: string; patch?: string }>;
    const reviewable = changed
      .filter((f) => f.status !== 'removed' && f.patch && ANALYZABLE_EXTENSIONS.has(f.filename.split('.').pop()?.toLowerCase() ?? ''))
      .slice(0, MAX_PR_FILES);

    // raw.githubusercontent.com doesn't count against the API rate limit; the
    // head repo is the fork for a PR from one.
    const headRepo = pr.head.repo?.full_name ?? pr.base.repo.full_name;
    const files: ScannedFile[] = [];
    await Promise.all(
      reviewable.map(async (f) => {
        const res = await fetch(`https://raw.githubusercontent.com/${headRepo}/${pr.head.sha}/${f.filename.split('/').map(encodeURIComponent).join('/')}`);
        if (!res.ok) return;
        const content = await res.text();
        if (content.length > MAX_PR_FILE_BYTES) return;
        files.push({ path: f.filename, content, changedRanges: parseChangedRanges(f.patch!) });
      }),
    );
    files.sort((a, b) => a.path.localeCompare(b.path));

    const checks = await fetchCiChecks(this.githubHeaders(), owner, repo, pr.head.sha);
    const snapshot = toPrSnapshot(pr, owner, repo, number, checks, files.length, changed.length);

    const shareId = crypto.randomBytes(9).toString('base64url');
    await this.repositories.createDiffReview(
      await this.systemActor(),
      files,
      { sourceName, sourceType: 'github_pr', pullRequestUrl: pr.html_url },
      {
        skipQuota: true,
        localOnly: true,
        isPublic: true,
        shareId,
        requesterIpHash: ipHash,
        prSnapshot: snapshot,
      },
    );
    this.logger.log(`Public PR review started for ${sourceName}@${pr.head.sha.slice(0, 7)} (${shareId})`);
    return { shareId, reused: false };
  }

  private async contributorStats(owner: string, repo: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/stats/contributors`, { headers: this.githubHeaders() });
      if (res.status === 202 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      if (!res.ok) return undefined;
      const body: unknown = await res.json();
      return Array.isArray(body) ? mapGithubContributorStats(body) : undefined;
    }
    return undefined;
  }

  /** Turn sharing on for a scan the actor can see; returns the stable share id. */
  async share(actor: WorkspaceActor, scanId: string): Promise<{ shareId: string; isPublic: true }> {
    const job = await this.prisma.scanJob.findUnique({ where: { id: scanId } });
    if (!job || !canViewResource(actor, job)) throw new NotFoundException(`Scan ${scanId} not found`);
    if (job.status !== 'completed') throw new BadRequestException('Only a completed scan can be shared.');
    const shareId = job.shareId ?? crypto.randomBytes(9).toString('base64url');
    await this.prisma.scanJob.update({ where: { id: scanId }, data: { shareId, isPublic: true } });
    return { shareId, isPublic: true };
  }

  async unshare(actor: WorkspaceActor, scanId: string): Promise<{ isPublic: false }> {
    const job = await this.prisma.scanJob.findUnique({ where: { id: scanId } });
    if (!job || !canViewResource(actor, job)) throw new NotFoundException(`Scan ${scanId} not found`);
    await this.prisma.scanJob.update({ where: { id: scanId }, data: { isPublic: false } });
    return { isPublic: false };
  }

  /**
   * The public view of a shared scan. Deliberately narrower than the owner's
   * view: no secret locations or snippets (counts and types only), no
   * contributor names or emails (share of commits only), and no account,
   * token-usage or PR details.
   */
  async getShared(shareId: string) {
    const job = await this.prisma.scanJob.findUnique({ where: { shareId }, include: { files: true } });
    if (!job || !job.isPublic) throw new NotFoundException('This report is private or no longer shared.');

    const contributors = Array.isArray(job.contributorStats)
      ? (job.contributorStats as Array<{ author?: string; commits?: number }>)
      : [];
    const totalCommits = contributors.reduce((s, c) => s + (c.commits ?? 0), 0);
    const topCommits = contributors.reduce((m, c) => Math.max(m, c.commits ?? 0), 0);
    const names = contributors.map((c) => c.author).filter((n): n is string => Boolean(n) && n!.length > 1);
    const anonymize = (text: string) => {
      const out = names.reduce((t, n) => t.split(n).join('one contributor'), text);
      return out.charAt(0).toUpperCase() + out.slice(1);
    };

    const prSnapshot = job.sourceType === 'github_pr' ? (job.prSnapshot as unknown as PrSnapshot | null) : null;

    let riskAggregation: ReturnType<typeof aggregateRisk> | null = null;
    // Repo-wide risk areas (dependencies, team, architecture) don't apply to a handful of changed files.
    if (job.status === 'completed' && !prSnapshot) {
      const r = aggregateRisk(job);
      riskAggregation = {
        ...r,
        summary: anonymize(r.summary),
        // Rebuilt field by field: the talent category also carries the top
        // contributor's username, which must not reach a public page.
        categories: r.categories.map((c) => ({ category: c.category, riskLevel: c.riskLevel, detail: anonymize(c.detail) })),
        recommendations: r.recommendations.map(anonymize),
      };
    }

    const secrets = Array.isArray(job.secrets) ? (job.secrets as Array<{ rule?: string }>) : null;
    const secretTypes: Record<string, number> = {};
    for (const s of secrets ?? []) secretTypes[s.rule ?? 'Secret'] = (secretTypes[s.rule ?? 'Secret'] ?? 0) + 1;
    const repoRef = (job.repoRef ?? null) as { kind?: string; owner?: string; repo?: string; ref?: string } | null;

    let pullRequest: Record<string, unknown> | null = null;
    if (prSnapshot) {
      pullRequest = {
        // Who a "Post on GitHub" would post as; null when this server can't.
        postAs: this.config.get<string>('GITHUB_BOT_TOKEN') ? this.config.get<string>('GITHUB_BOT_LOGIN') || 'auditbenchai' : null,
        postedAt: job.prPublishedAt,
        number: prSnapshot.number,
        title: prSnapshot.title,
        url: prSnapshot.url,
        state: prSnapshot.state,
        merged: prSnapshot.merged,
        draft: prSnapshot.draft,
        mergeable: prSnapshot.mergeable,
        mergeableState: prSnapshot.mergeableState,
        baseRef: prSnapshot.baseRef,
        headRef: prSnapshot.headRef,
        headSha: prSnapshot.headSha,
        additions: prSnapshot.additions,
        deletions: prSnapshot.deletions,
        changedFiles: prSnapshot.changedFiles,
        commits: prSnapshot.commits,
        checks: prSnapshot.checks,
        filesReviewed: prSnapshot.filesReviewed,
        filesSkipped: prSnapshot.filesSkipped,
        fetchedAt: prSnapshot.fetchedAt,
        readiness: readinessForScan(job),
      };
    }

    return {
      shareId: job.shareId,
      pullRequest,
      sourceName: job.sourceName,
      sourceType: job.sourceType,
      repoUrl: prSnapshot
        ? `https://github.com/${prSnapshot.owner}/${prSnapshot.repo}`
        : repoRef?.kind === 'github' && repoRef.owner
          ? `https://github.com/${repoRef.owner}/${repoRef.repo}`
          : null,
      ref: repoRef?.ref ?? null,
      status: job.status,
      error: job.status === 'failed' ? 'The scan could not be completed.' : null,
      framework: job.framework,
      fileCount: job.fileCount,
      filesScanned: job.filesScanned,
      verdict: job.verdict,
      localOnly: job.localOnly,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      riskAggregation,
      secrets: secrets ? { count: secrets.length, types: secretTypes } : null,
      dependencyVulnerabilities: job.dependencyVulnerabilities,
      licenseFindings: job.licenseFindings,
      testCoverage: job.testCoverage,
      circularImports: job.circularImports,
      deadCode: job.deadCode,
      duplicates: job.duplicates,
      contributors: contributors.length
        ? { count: contributors.length, topSharePct: totalCommits ? Math.round((topCommits / totalCommits) * 100) : 0 }
        : null,
      files: job.files
        .map((f) => ({ path: f.path, language: f.language, verdict: f.verdict, findings: f.findings }))
        .sort((a, b) => (Array.isArray(b.findings) ? b.findings.length : 0) - (Array.isArray(a.findings) ? a.findings.length : 0)),
    };
  }
}

