import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TokenCryptoService } from '../common/token-crypto.service';
import { requireJwtSecret } from '../auth/jwt-secret';
import { GithubAppAuthService } from '../github/github-app-auth.service';
import { GithubService } from '../github/github.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { CHECK_NAME } from '../pr-feedback/check-run';

const GITHUB_API = 'https://api.github.com';
const STATE_TTL_MS = 30 * 60_000;
const BOT_MENTION = '@auditbench';
const AUTO_REVIEW_ACTIONS = new Set(['opened', 'reopened', 'synchronize', 'ready_for_review']);

type StateKind = 'install' | 'manifest';

/**
 * The Audit Bench Ai GitHub App: created in one click from the admin panel
 * (GitHub's app-manifest flow), installed by users on their accounts or
 * organizations, and driven by one webhook for every installed repository.
 * Reviews, thread replies and @mention answers then post as the app's bot,
 * with no per-repo webhook to set up.
 */
@Injectable()
export class GithubAppService {
  private readonly logger = new Logger(GithubAppService.name);
  private readonly stateKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tokenCrypto: TokenCryptoService,
    private readonly appAuth: GithubAppAuthService,
    private readonly github: GithubService,
    private readonly webhooks: WebhooksService,
  ) {
    this.stateKey = crypto
      .createHash('sha256')
      .update(`github-app-state:${requireJwtSecret(config)}`)
      .digest();
  }

  private origin(name: 'FRONTEND_ORIGIN' | 'BACKEND_ORIGIN', fallback: string) {
    return (this.config.get<string>(name) || fallback).split(',')[0].trim().replace(/\/$/, '');
  }
  private frontend() {
    return this.origin('FRONTEND_ORIGIN', 'http://localhost:3000');
  }
  private backend() {
    return this.origin('BACKEND_ORIGIN', 'http://localhost:4000');
  }

  /** A short-lived, signed value round-tripped through GitHub, so its redirects can't be forged. */
  signState(kind: StateKind, subject: string, now = Date.now()): string {
    const body = `${kind}.${subject}.${now + STATE_TTL_MS}`;
    const mac = crypto.createHmac('sha256', this.stateKey).update(body).digest('base64url');
    return `${Buffer.from(body).toString('base64url')}.${mac}`;
  }

  verifyState(kind: StateKind, state: string | undefined, now = Date.now()): string | null {
    if (!state) return null;
    const [encoded, mac] = state.split('.');
    if (!encoded || !mac) return null;
    const body = Buffer.from(encoded, 'base64url').toString();
    const expected = crypto.createHmac('sha256', this.stateKey).update(body).digest('base64url');
    if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    const [k, subject, exp] = body.split('.');
    if (k !== kind || !subject || Number(exp) < now) return null;
    return subject;
  }

  // ---------- Status and installation management ----------

  async status(userId: string) {
    const creds = await this.appAuth.credentials();
    const row = creds ? await this.prisma.githubAppConfig.findUnique({ where: { id: 'default' } }) : null;
    const installations = await this.prisma.githubInstallation.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        accountLogin: true,
        accountType: true,
        repositorySelection: true,
        autoReview: true,
        suspended: true,
      },
    });
    return {
      configured: Boolean(creds),
      slug: creds?.slug || null,
      name: row?.name ?? null,
      htmlUrl: row?.htmlUrl ?? (creds?.slug ? `https://github.com/apps/${creds.slug}` : null),
      botLogin: creds?.slug ? `${creds.slug}[bot]` : null,
      installations,
    };
  }

  async installUrl(userId: string): Promise<{ url: string }> {
    const creds = await this.appAuth.requireCredentials();
    if (!creds.slug) throw new ServiceUnavailableException('Set GITHUB_APP_SLUG so we know where to send you.');
    return {
      url: `https://github.com/apps/${creds.slug}/installations/new?state=${encodeURIComponent(this.signState('install', userId))}`,
    };
  }

  /**
   * Where GitHub sends the browser after an install. With our signed state
   * the installation is linked to the user who clicked Install; without it
   * (installed from GitHub directly) the app page asks the user to claim it.
   */
  async handleSetup(installationId: number, state: string | undefined): Promise<string> {
    const base = `${this.frontend()}/app/repository?source=github`;
    if (!Number.isInteger(installationId) || installationId <= 0) return `${base}&githubApp=error`;
    const userId = this.verifyState('install', state);
    try {
      await this.upsertInstallation(installationId, userId);
    } catch (err) {
      this.logger.error(`Setup for installation ${installationId} failed`, err as Error);
      return `${base}&githubApp=error`;
    }
    return userId ? `${base}&githubApp=installed` : `${base}&githubApp=claim&installation=${installationId}`;
  }

  private async upsertInstallation(installationId: number, userId: string | null) {
    const inst = await this.appAuth.getInstallation(installationId);
    const data = {
      accountLogin: inst.account.login,
      accountType: inst.account.type,
      repositorySelection: inst.repository_selection,
      suspended: Boolean(inst.suspended_at),
    };
    await this.prisma.githubInstallation.upsert({
      where: { id: installationId },
      create: { id: installationId, ...data, userId },
      // Never steal an installation someone else already linked.
      update: userId ? { ...data, userId: undefined } : data,
    });
    if (userId) {
      await this.prisma.githubInstallation.updateMany({
        where: { id: installationId, userId: null },
        data: { userId },
      });
    }
  }

  /**
   * Links an installation made from GitHub directly. Proven through the
   * user's connected GitHub account: it must be the installed account
   * itself, or an admin of the installed organization.
   */
  async claim(userId: string, installationId: number) {
    const inst = await this.prisma.githubInstallation.findUnique({ where: { id: installationId } });
    if (!inst)
      throw new NotFoundException('That installation was not found. Install the app again from Audit Bench Ai.');
    if (inst.userId && inst.userId !== userId) {
      throw new ForbiddenException('This installation is already linked to another Audit Bench Ai account.');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.githubUsername) {
      throw new ForbiddenException('Connect GitHub first, so we can check you manage this account.');
    }
    let allowed = inst.accountType === 'User' && inst.accountLogin.toLowerCase() === user.githubUsername.toLowerCase();
    if (!allowed && inst.accountType === 'Organization' && user.githubToken) {
      const res = await fetch(`${GITHUB_API}/user/memberships/orgs/${encodeURIComponent(inst.accountLogin)}`, {
        headers: {
          Authorization: `Bearer ${this.tokenCrypto.decrypt(user.githubToken)}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'audit-bench-app',
        },
      });
      const m = res.ok ? ((await res.json()) as { role?: string; state?: string }) : {};
      allowed = m.role === 'admin' && m.state === 'active';
    }
    if (!allowed) {
      throw new ForbiddenException(
        `Only @${inst.accountLogin}${inst.accountType === 'Organization' ? " or one of the organization's admins" : ''} can link this installation. You're connected as @${user.githubUsername}.`,
      );
    }
    await this.prisma.githubInstallation.update({ where: { id: installationId }, data: { userId } });
    return this.status(userId);
  }

  async update(userId: string, installationId: number, autoReview: boolean) {
    const inst = await this.prisma.githubInstallation.findUnique({ where: { id: installationId } });
    if (!inst || inst.userId !== userId) throw new NotFoundException('Installation not found');
    await this.prisma.githubInstallation.update({ where: { id: installationId }, data: { autoReview } });
    return this.status(userId);
  }

  async unlink(userId: string, installationId: number) {
    const inst = await this.prisma.githubInstallation.findUnique({ where: { id: installationId } });
    if (!inst || inst.userId !== userId) throw new NotFoundException('Installation not found');
    await this.prisma.githubInstallation.update({ where: { id: installationId }, data: { userId: null } });
    return this.status(userId);
  }

  // ---------- One-click app creation (super admin) ----------

  /** The manifest and form target for GitHub's "create an app from a manifest" flow. */
  manifest(userId: string, org?: string) {
    const site = this.frontend();
    const manifest = {
      name: this.config.get<string>('GITHUB_APP_NAME') || 'Audit Bench Ai',
      url: site,
      description:
        'AI code review on every pull request: inline comments with fixes, merge risk, pre-merge checks, and answers when you reply.',
      hook_attributes: { url: `${this.backend()}/webhooks/github-app`, active: true },
      redirect_url: `${this.backend()}/github-app/manifest/callback`,
      setup_url: `${this.backend()}/github-app/setup`,
      setup_on_update: true,
      public: true,
      // Least privilege: read code; write PR reviews and comments (this also
      // covers comments in the PR conversation); write the verdict as a check.
      default_permissions: {
        metadata: 'read',
        contents: 'read',
        pull_requests: 'write',
        checks: 'write',
      },
      default_events: ['pull_request', 'pull_request_review_comment', 'issue_comment', 'check_run'],
    };
    const owner = org?.trim();
    if (owner && !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(owner)) {
      throw new BadRequestException(
        `"${owner}" isn't a GitHub organization login. Leave it empty for your personal account.`,
      );
    }
    const action = `https://github.com/${owner ? `organizations/${encodeURIComponent(owner)}/` : ''}settings/apps/new?state=${encodeURIComponent(this.signState('manifest', userId))}`;
    return { action, manifest: JSON.stringify(manifest) };
  }

  /** GitHub sends the browser here after the app is created: swap the code for its credentials and store them. */
  async handleManifestCallback(code: string, state: string | undefined): Promise<string> {
    const back = `${this.frontend()}/app/admin?tab=github-app`;
    if (!this.verifyState('manifest', state) || !code) return `${back}&githubApp=error`;
    const res = await fetch(`${GITHUB_API}/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: 'POST',
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'audit-bench-app' },
    });
    if (!res.ok) {
      this.logger.error(`App manifest conversion failed (${res.status})`);
      return `${back}&githubApp=error`;
    }
    const app = (await res.json()) as {
      id: number;
      slug: string;
      name: string;
      html_url: string;
      client_id?: string;
      client_secret?: string;
      webhook_secret: string;
      pem: string;
    };
    const data = {
      appId: app.id,
      slug: app.slug,
      name: app.name,
      htmlUrl: app.html_url,
      clientId: app.client_id ?? null,
      clientSecret: app.client_secret ? this.tokenCrypto.encrypt(app.client_secret) : null,
      privateKey: this.tokenCrypto.encrypt(app.pem),
      webhookSecret: this.tokenCrypto.encrypt(app.webhook_secret),
    };
    await this.prisma.githubAppConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', ...data },
      update: data,
    });
    this.appAuth.reset();
    this.logger.log(`GitHub App "${app.slug}" (${app.id}) created`);
    return `${back}&githubApp=created`;
  }

  // ---------- Webhook ----------

  async handleWebhook(event: string, rawBody: Buffer, body: any, signature: string | undefined) {
    const creds = await this.appAuth.credentials();
    if (!creds) throw new ServiceUnavailableException("The GitHub App isn't set up.");
    if (!GithubService.verifyWebhookSignature(creds.webhookSecret, rawBody, signature)) {
      throw new ForbiddenException('Invalid webhook signature');
    }
    const installationId: number | undefined = body?.installation?.id;
    if (!installationId) return { ok: true, skipped: 'no installation' };

    if (event === 'installation') {
      if (body.action === 'deleted') {
        await this.prisma.githubInstallation.deleteMany({ where: { id: installationId } });
      } else if (body.action === 'suspend' || body.action === 'unsuspend') {
        await this.prisma.githubInstallation.updateMany({
          where: { id: installationId },
          data: { suspended: body.action === 'suspend' },
        });
      } else if (body.action === 'created') {
        await this.upsertInstallation(installationId, null);
      }
      return { ok: true };
    }
    if (event === 'installation_repositories') {
      await this.prisma.githubInstallation.updateMany({
        where: { id: installationId },
        data: { repositorySelection: body.repository_selection ?? 'selected' },
      });
      return { ok: true };
    }

    const inst = await this.prisma.githubInstallation.findUnique({
      where: { id: installationId },
      include: { user: { select: { id: true, organizationId: true, isActive: true } } },
    });
    if (!inst?.user || !inst.user.isActive)
      return { ok: true, skipped: 'installation not linked to an active account' };
    if (inst.suspended) return { ok: true, skipped: 'installation suspended' };
    // Our own bot's comments and other bots' never trigger work.
    if (body?.sender?.type === 'Bot') return { ok: true, skipped: 'comment from a bot' };

    const auth = { installationId };
    const [owner, repo] = String(body?.repository?.full_name ?? '/').split('/');

    // "Re-run" on the Audit Bench Ai check in GitHub: review that PR again.
    if (event === 'check_run' && body.action === 'rerequested' && body.check_run?.name === CHECK_NAME) {
      const prs: Array<{ number: number }> = body.check_run.pull_requests ?? [];
      for (const pr of prs) {
        void this.webhooks.autoReviewPullRequest(auth, inst.user, owner, repo, pr.number, body.check_run.head_sha);
      }
      return { ok: true, status: prs.length ? 'reviewing again' : 'no pull request on this check' };
    }
    if (event === 'pull_request' && body.action === 'closed') {
      void this.webhooks.harvestReactions(auth, inst.user.id, owner, repo, body.pull_request.number);
      return { ok: true, status: 'collecting feedback' };
    }
    if (event === 'pull_request') {
      if (!inst.autoReview) return { ok: true, skipped: 'auto-review off' };
      if (!AUTO_REVIEW_ACTIONS.has(body.action)) return { ok: true, skipped: `action "${body.action}"` };
      if (body.pull_request?.draft) return { ok: true, skipped: 'draft PR' };
      const pullNumber: number = body.pull_request.number;
      if (
        await this.webhooks.alreadyReviewed('github_pr', `${owner}/${repo}#${pullNumber}`, body.pull_request.head?.sha)
      ) {
        return { ok: true, skipped: 'this commit was already reviewed' };
      }
      // Answer GitHub fast; the review runs in the background.
      void this.webhooks.autoReviewPullRequest(auth, inst.user, owner, repo, pullNumber, body.pull_request.head?.sha);
      return { ok: true, status: 'reviewing' };
    }

    if (event === 'pull_request_review_comment' && body.action === 'created') {
      void this.webhooks.recheckThread(auth, inst.user.id, body);
      return { ok: true, status: 'rechecking' };
    }

    if (event === 'issue_comment' && body.action === 'created' && body.issue?.pull_request) {
      const text: string = body.comment?.body ?? '';
      if (!text.toLowerCase().includes(BOT_MENTION) || text.includes('<!-- audit-bench')) {
        return { ok: true, skipped: 'no mention' };
      }
      void this.webhooks.answerMention(auth, owner, repo, body.issue.number, text);
      return { ok: true, status: 'answering' };
    }

    return { ok: true, skipped: `event "${event}"` };
  }
}
