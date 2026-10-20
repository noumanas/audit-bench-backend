import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TokenCryptoService } from '../common/token-crypto.service';
import { gitHostRequestFailed } from '../common/git-host-errors';
import { parseUnifiedDiff } from '../common/diff-ranges';
import { PrFeedbackService } from '../pr-feedback/pr-feedback.service';
import { PrContext, PrFeedback, PrPublisher } from '../pr-feedback/pr-feedback.types';
import { commentLines, inlineCommentBody } from '../pr-feedback/inline-comment';
import { buildPlainSummary } from '../pr-feedback/summary-comment';
import { ScannedFile } from '../analysis/types';

const API = 'https://api.bitbucket.org/2.0';
/** Bitbucket names are letters, digits, "-", "_" and "."; keeps user input out of URL paths. */
const NAME = /^[A-Za-z0-9_.-]{1,128}$/;

export interface BitbucketRepoSummary {
  workspace: string;
  slug: string;
  fullName: string;
  private: boolean;
  description: string | null;
  defaultBranch: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface BitbucketPrSummary {
  id: number;
  title: string;
  sourceBranch: string;
  destinationBranch: string;
  draft: boolean;
  updatedAt: string;
  htmlUrl: string;
}

export interface BitbucketPrDetails {
  files: ScannedFile[];
  headSha: string;
  url: string;
  sourceBranch: string;
  destinationBranch: string;
}

function assertName(...names: string[]) {
  for (const n of names) if (!NAME.test(n)) throw new BadRequestException(`"${n}" isn't a valid Bitbucket name.`);
}

/**
 * Bitbucket Cloud, with an API token sent as a Bearer token (Atlassian
 * retired app passwords in 2026). Repository scans, pull request reviews
 * scoped to the diff, inline comments, a summary comment and a build status.
 * Bitbucket's Markdown shows HTML as text, so comments use the plain variants.
 */
@Injectable()
export class BitbucketService implements OnModuleInit, PrPublisher {
  private readonly logger = new Logger(BitbucketService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prFeedback: PrFeedbackService,
    private readonly tokenCrypto: TokenCryptoService,
  ) {}

  onModuleInit() {
    this.prFeedback.register('bitbucket', this);
  }

  private headers(token: string, json = true): Record<string, string> {
    return { Authorization: `Bearer ${token}`, ...(json ? { Accept: 'application/json' } : {}) };
  }

  private async requireToken(userId: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.bitbucketToken) throw new BadRequestException('Connect a Bitbucket account first');
    return this.tokenCrypto.decrypt(user.bitbucketToken);
  }

  private async get<T>(token: string, url: string): Promise<T> {
    const res = await fetch(url.startsWith('http') ? url : `${API}${url}`, { headers: this.headers(token) });
    if (res.status === 404) throw new NotFoundException('Not found on Bitbucket, or not visible to this token');
    if (!res.ok) throw gitHostRequestFailed('Bitbucket', res.status);
    return res.json() as Promise<T>;
  }

  async connect(userId: string, token: string) {
    // A user's API token can read /user; a workspace or repository access
    // token can't, but can still list the repositories it was made for.
    let username: string | null = null;
    const me = await fetch(`${API}/user`, { headers: this.headers(token) });
    if (me.ok) {
      const body = (await me.json()) as { username?: string; display_name?: string };
      username = body.username ?? body.display_name ?? null;
    } else {
      const repos = await fetch(`${API}/repositories?role=member&pagelen=1`, { headers: this.headers(token) });
      if (!repos.ok) {
        throw new BadRequestException(
          me.status === 401 || repos.status === 401
            ? 'That Bitbucket token was rejected. Check it has the read:repository:bitbucket and read:pullrequest:bitbucket scopes and hasn’t expired.'
            : `Bitbucket rejected the request (${repos.status})`,
        );
      }
      username = 'access token';
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { bitbucketToken: this.tokenCrypto.encrypt(token), bitbucketUsername: username },
    });
    return { username };
  }

  async disconnect(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { bitbucketToken: null, bitbucketUsername: null } });
  }

  async status(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return { connected: Boolean(user.bitbucketToken), username: user.bitbucketUsername };
  }

  async listRepos(userId: string): Promise<BitbucketRepoSummary[]> {
    const token = await this.requireToken(userId);
    const body = await this.get<{ values: any[] }>(token, '/repositories?role=member&pagelen=100&sort=-updated_on');
    return body.values.map((r) => ({
      workspace: r.workspace?.slug ?? String(r.full_name).split('/')[0],
      slug: r.slug ?? String(r.full_name).split('/')[1],
      fullName: r.full_name,
      private: Boolean(r.is_private),
      description: r.description || null,
      defaultBranch: r.mainbranch?.name ?? 'main',
      updatedAt: r.updated_on,
      htmlUrl: r.links?.html?.href ?? `https://bitbucket.org/${r.full_name}`,
    }));
  }

  async listBranches(userId: string, workspace: string, slug: string): Promise<string[]> {
    assertName(workspace, slug);
    const token = await this.requireToken(userId);
    const body = await this.get<{ values: Array<{ name: string }> }>(
      token,
      `/repositories/${workspace}/${slug}/refs/branches?pagelen=100&sort=-target.date`,
    );
    return body.values.map((b) => b.name);
  }

  async listPullRequests(userId: string, workspace: string, slug: string): Promise<BitbucketPrSummary[]> {
    assertName(workspace, slug);
    const token = await this.requireToken(userId);
    const body = await this.get<{ values: any[] }>(
      token,
      `/repositories/${workspace}/${slug}/pullrequests?state=OPEN&pagelen=50`,
    );
    return body.values.map((p) => ({
      id: p.id,
      title: p.title,
      sourceBranch: p.source?.branch?.name ?? '',
      destinationBranch: p.destination?.branch?.name ?? '',
      draft: Boolean(p.draft),
      updatedAt: p.updated_on,
      htmlUrl: p.links?.html?.href ?? '',
    }));
  }

  async getRepoMeta(userId: string, workspace: string, slug: string): Promise<{ defaultBranch: string }> {
    assertName(workspace, slug);
    const token = await this.requireToken(userId);
    const r = await this.get<{ mainbranch?: { name: string } }>(token, `/repositories/${workspace}/${slug}`);
    return { defaultBranch: r.mainbranch?.name ?? 'main' };
  }

  async downloadRepoZip(userId: string, workspace: string, slug: string, ref: string): Promise<Buffer> {
    assertName(workspace, slug);
    const token = await this.requireToken(userId);
    const res = await fetch(`https://bitbucket.org/${workspace}/${slug}/get/${encodeURIComponent(ref)}.zip`, {
      headers: this.headers(token, false),
    });
    if (res.status === 404)
      throw new NotFoundException(`${workspace}/${slug} at ${ref} wasn't found, or isn't visible to this token`);
    if (!res.ok) throw new BadRequestException(`Bitbucket rejected the download (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  /**
   * A PR's changed files at its source commit, each with the line ranges
   * the diff touched — so the review can stay on the changed lines.
   */
  async fetchPrFiles(userId: string, workspace: string, slug: string, pullId: number): Promise<BitbucketPrDetails> {
    assertName(workspace, slug);
    const token = await this.requireToken(userId);
    const pr = await this.get<any>(token, `/repositories/${workspace}/${slug}/pullrequests/${pullId}`);
    // PRs carry a 12-character hash; the build status API wants the full one.
    const commit = await this.get<{ hash: string }>(
      token,
      `/repositories/${workspace}/${slug}/commit/${encodeURIComponent(pr.source.commit.hash)}`,
    );
    const diffRes = await fetch(`${API}/repositories/${workspace}/${slug}/pullrequests/${pullId}/diff`, {
      headers: this.headers(token, false),
    });
    if (!diffRes.ok) throw gitHostRequestFailed('Bitbucket', diffRes.status);
    const changed = parseUnifiedDiff(await diffRes.text()).filter((f) => f.status !== 'removed' && f.ranges.length);

    const files: ScannedFile[] = [];
    for (const f of changed.slice(0, 100)) {
      const res = await fetch(
        `${API}/repositories/${workspace}/${slug}/src/${commit.hash}/${f.path.split('/').map(encodeURIComponent).join('/')}`,
        { headers: this.headers(token, false) },
      );
      if (!res.ok) continue;
      files.push({ path: f.path, content: await res.text(), changedRanges: f.ranges });
    }
    return {
      files,
      headSha: commit.hash,
      url: pr.links?.html?.href ?? `https://bitbucket.org/${workspace}/${slug}/pull-requests/${pullId}`,
      sourceBranch: pr.source?.branch?.name ?? '',
      destinationBranch: pr.destination?.branch?.name ?? '',
    };
  }

  /** PrPublisher: inline comments, a summary comment, and a pass/fail build status. */
  async publish(
    userId: string,
    context: Extract<PrContext, { kind: 'bitbucket' }>,
    feedback: PrFeedback,
  ): Promise<void> {
    const token = await this.requireToken(userId);
    const base = `${API}/repositories/${context.workspace}/${context.repoSlug}`;
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: 'POST',
        headers: { ...this.headers(token), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    let posted = 0;
    let firstError: string | null = null;
    for (const f of feedback.findings.slice(0, 50)) {
      const at = commentLines(f, feedback.changedRanges?.[f.path]);
      if (!at) continue;
      const res = await post(`/pullrequests/${context.pullId}/comments`, {
        content: { raw: inlineCommentBody(f, { plain: true }) },
        inline: { path: f.path, to: at.start },
      });
      if (res.ok) posted++;
      else firstError ??= `Bitbucket refused an inline comment (${res.status})`;
    }

    const summary = await post(`/pullrequests/${context.pullId}/comments`, {
      content: { raw: buildPlainSummary(feedback, { posted, headSha: context.headSha }) },
    });
    if (!summary.ok) {
      throw new Error(
        summary.status === 401 || summary.status === 403
          ? `Bitbucket refused the comment (${summary.status}). The token needs the read:pullrequest:bitbucket scope, and access to this repository.`
          : `Bitbucket refused the comment (${summary.status}).${firstError ? ` ${firstError}.` : ''}`,
      );
    }

    // Needs write access to the repository; without it the review still stands.
    const blocking = feedback.verdict === 'do_not_ship';
    const status = await post(`/commit/${context.headSha}/statuses/build`, {
      key: 'audit-bench',
      name: 'Audit Bench Ai',
      state: blocking ? 'FAILED' : 'SUCCESSFUL',
      description: blocking
        ? 'Audit Bench Ai found blocking issues'
        : feedback.verdict === 'needs_work'
          ? 'Audit Bench Ai found issues worth reviewing'
          : 'Audit Bench Ai found no issues',
      url: feedback.scanUrl ?? 'https://auditbenchai.com',
    });
    if (!status.ok)
      this.logger.warn(`Build status not set on ${context.workspace}/${context.repoSlug} (${status.status})`);
  }

  /** Bitbucket signs webhook deliveries with `X-Hub-Signature: sha256=<hmac>` over the raw body. */
  static verifyWebhookSignature(secret: string, rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader?.startsWith('sha256=')) return false;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const given = signatureHeader.slice('sha256='.length);
    return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  }
}
