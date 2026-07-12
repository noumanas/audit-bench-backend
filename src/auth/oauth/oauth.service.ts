import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { gitlabInstanceUrl } from '../../common/gitlab-url';
import { TokenCryptoService } from '../../common/token-crypto.service';
import { OAuthProfile, OAuthProvider, OAuthTokenSet } from './oauth.types';

const DEFAULT_PLAN_SLUG = 'free';
const LOGIN_CODE_TTL_MS = 60_000;

@Injectable()
export class OAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tokenCrypto: TokenCryptoService,
  ) {}

  redirectUri(provider: OAuthProvider): string {
    const origin = this.config.get<string>('BACKEND_ORIGIN') || 'http://localhost:4000';
    return `${origin}/auth/${provider}/callback`;
  }

  getAuthorizeUrl(provider: OAuthProvider, state: string): string {
    if (provider === 'github') {
      const clientId = this.requireClientId('github');
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: this.redirectUri('github'),
        scope: 'repo user:email',
        state,
      });
      return `https://github.com/login/oauth/authorize?${params}`;
    }

    const clientId = this.requireClientId('gitlab');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.redirectUri('gitlab'),
      response_type: 'code',
      scope: 'api',
      state,
    });
    return `${gitlabInstanceUrl((k) => this.config.get<string>(k))}/oauth/authorize?${params}`;
  }

  /** Runs the whole code → tokens → profile → user pipeline and returns a one-time login code. */
  async handleCallback(provider: OAuthProvider, code: string): Promise<string> {
    const tokens =
      provider === 'github' ? await this.exchangeGithubCode(code) : await this.exchangeGitlabCode(code);
    const profile =
      provider === 'github' ? await this.fetchGithubProfile(tokens.accessToken) : await this.fetchGitlabProfile(tokens.accessToken);
    const user = await this.findOrCreateUser(provider, profile, tokens);
    return this.mintLoginCode(user.id);
  }

  async exchangeLoginCode(code: string) {
    const record = await this.prisma.oAuthLoginCode.findUnique({ where: { code } });
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('This login link has expired or already been used — try signing in again.');
    }
    await this.prisma.oAuthLoginCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    return this.prisma.user.findUniqueOrThrow({ where: { id: record.userId }, include: { plan: true } });
  }

  private requireClientId(provider: OAuthProvider): string {
    const key = provider === 'github' ? 'GITHUB_OAUTH_CLIENT_ID' : 'GITLAB_OAUTH_CLIENT_ID';
    const clientId = this.config.get<string>(key);
    if (!clientId) {
      throw new BadRequestException(
        `${provider === 'github' ? 'GitHub' : 'GitLab'} login is not configured on this server.`,
      );
    }
    return clientId;
  }

  private async mintLoginCode(userId: string): Promise<string> {
    const code = crypto.randomBytes(24).toString('hex');
    await this.prisma.oAuthLoginCode.create({
      data: { code, userId, expiresAt: new Date(Date.now() + LOGIN_CODE_TTL_MS) },
    });
    return code;
  }

  private async findOrCreateUser(provider: OAuthProvider, profile: OAuthProfile, tokens: OAuthTokenSet) {
    const tokenFields =
      provider === 'github'
        ? { githubToken: this.tokenCrypto.encrypt(tokens.accessToken), githubUsername: profile.username }
        : {
            gitlabToken: this.tokenCrypto.encrypt(tokens.accessToken),
            gitlabUsername: profile.username,
            gitlabRefreshToken: tokens.refreshToken ? this.tokenCrypto.encrypt(tokens.refreshToken) : null,
            gitlabTokenExpiresAt: tokens.expiresAt,
          };
    const providerLabel = provider === 'github' ? 'GitHub' : 'GitLab';

    return this.prisma.$transaction(async (tx) => {
      const existingAccount = await tx.oAuthAccount.findUnique({
        where: { provider_providerUserId: { provider, providerUserId: profile.providerUserId } },
      });

      // Returning user — refresh the stored token/username, identity is
      // already established via the linked OAuthAccount row.
      if (existingAccount) {
        return tx.user.update({ where: { id: existingAccount.userId }, data: tokenFields, include: { plan: true } });
      }

      if (!profile.email) {
        throw new BadRequestException(
          `Your ${providerLabel} account has no accessible email address, so a new account can't be created. Add/verify an email on ${providerLabel} and try again.`,
        );
      }

      // Deliberately NOT auto-linking by email — a same-email OAuth login
      // never signs into an existing password account. See PRD discussion.
      const existingEmailUser = await tx.user.findUnique({ where: { email: profile.email } });
      if (existingEmailUser) {
        throw new ConflictException(
          `An account already exists for ${profile.email}. Log in with your password instead, or use a different ${providerLabel} account.`,
        );
      }

      const plan = await tx.plan.findUnique({ where: { slug: DEFAULT_PLAN_SLUG } });
      if (!plan) throw new Error(`Default plan "${DEFAULT_PLAN_SLUG}" is not seeded`);

      const superAdminEmail = this.config.get<string>('SUPER_ADMIN_EMAIL');
      const role: Role =
        superAdminEmail && superAdminEmail.toLowerCase() === profile.email.toLowerCase() ? 'super_admin' : 'user';

      const user = await tx.user.create({
        data: {
          email: profile.email,
          passwordHash: null,
          name: profile.username,
          planId: plan.id,
          role,
          ...tokenFields,
        },
        include: { plan: true },
      });

      await tx.oAuthAccount.create({ data: { userId: user.id, provider, providerUserId: profile.providerUserId } });

      return user;
    });
  }

  // ---------- GitHub ----------

  private async exchangeGithubCode(code: string): Promise<OAuthTokenSet> {
    const clientId = this.requireClientId('github');
    const clientSecret = this.config.get<string>('GITHUB_OAUTH_CLIENT_SECRET');
    if (!clientSecret) throw new BadRequestException('GitHub login is not configured on this server.');

    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: this.redirectUri('github'),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) {
      throw new BadRequestException(`GitHub rejected the login (${data.error_description || data.error || res.status})`);
    }
    return { accessToken: data.access_token, refreshToken: null, expiresAt: null };
  }

  private async fetchGithubProfile(accessToken: string): Promise<OAuthProfile> {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ai-code-auditor',
    };
    const res = await fetch('https://api.github.com/user', { headers });
    if (!res.ok) throw new BadRequestException(`GitHub rejected the profile request (${res.status})`);
    const profile = await res.json();

    let email: string | null = profile.email ?? null;
    if (!email) {
      const emailsRes = await fetch('https://api.github.com/user/emails', { headers });
      if (emailsRes.ok) {
        const emails: { email: string; primary: boolean; verified: boolean }[] = await emailsRes.json();
        email = emails.find((e) => e.primary && e.verified)?.email ?? emails.find((e) => e.verified)?.email ?? null;
      }
    }

    return { providerUserId: String(profile.id), username: profile.login, email };
  }

  // ---------- GitLab ----------

  private async exchangeGitlabCode(code: string): Promise<OAuthTokenSet> {
    const clientId = this.requireClientId('gitlab');
    const clientSecret = this.config.get<string>('GITLAB_OAUTH_CLIENT_SECRET');
    if (!clientSecret) throw new BadRequestException('GitLab login is not configured on this server.');

    return this.requestGitlabToken({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: this.redirectUri('gitlab'),
    });
  }

  private async requestGitlabToken(body: Record<string, string>): Promise<OAuthTokenSet> {
    const res = await fetch(`${gitlabInstanceUrl((k) => this.config.get<string>(k))}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) {
      throw new BadRequestException(`GitLab rejected the login (${data.error_description || data.error || res.status})`);
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? null,
      expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    };
  }

  private async fetchGitlabProfile(accessToken: string): Promise<OAuthProfile> {
    const res = await fetch(`${gitlabInstanceUrl((k) => this.config.get<string>(k))}/api/v4/user`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new BadRequestException(`GitLab rejected the profile request (${res.status})`);
    const profile = await res.json();
    return { providerUserId: String(profile.id), username: profile.username, email: profile.email ?? null };
  }
}
