import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RepositoryService } from '../repository/repository.service';
import { aggregateRisk } from '../repository/risk-aggregation';
import { mapGithubContributorStats } from '../github/github.service';
import { WorkspaceActor, canViewResource } from '../common/workspace-scope';
import { parseGithubRepoUrl } from './github-url';

const GITHUB_API = 'https://api.github.com';
const SYSTEM_EMAIL = 'public-scans@system.auditbenchai.local';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** GitHub reports repo size in KB. Bigger repos take too long for a free scan. */
const MAX_REPO_KB = 250 * 1024;

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
    const parsed = parseGithubRepoUrl(repoUrl);
    if (!parsed) {
      throw new BadRequestException('Enter a public GitHub repository, like https://github.com/owner/repo');
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

    let riskAggregation: ReturnType<typeof aggregateRisk> | null = null;
    if (job.status === 'completed') {
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

    return {
      shareId: job.shareId,
      sourceName: job.sourceName,
      sourceType: job.sourceType,
      repoUrl: repoRef?.kind === 'github' && repoRef.owner ? `https://github.com/${repoRef.owner}/${repoRef.repo}` : null,
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
