import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TokenCryptoService } from '../common/token-crypto.service';
import { gitHostRequestFailed } from '../common/git-host-errors';

const GITHUB_API = 'https://api.github.com';

export interface GithubAppCredentials {
  appId: number;
  slug: string;
  privateKey: string;
  webhookSecret: string;
}

/**
 * Who a GitHub call acts as: a user id (that user's connected token) or an
 * installation of the Audit Bench Ai GitHub App (comments then appear as the
 * app's bot account).
 */
export type GithubAuth = string | { installationId: number };

/** Signs a GitHub App JWT (RS256): valid ~10 minutes, backdated a minute for clock drift. */
export function signAppJwt(appId: number, privateKeyPem: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const b64 = (v: object | Buffer) => (Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v))).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: String(appId) })}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(privateKeyPem);
  return `${unsigned}.${b64(signature)}`;
}

/**
 * Credentials and tokens for the GitHub App. Credentials come from the
 * GITHUB_APP_* environment variables when set, otherwise from the encrypted
 * GithubAppConfig row the one-click setup stores. Installation tokens last an
 * hour; they're cached until five minutes before they expire.
 */
@Injectable()
export class GithubAppAuthService {
  private readonly tokens = new Map<number, { token: string; expiresAt: number }>();
  private cached: { value: GithubAppCredentials | null; at: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly tokenCrypto: TokenCryptoService,
  ) {}

  async credentials(): Promise<GithubAppCredentials | null> {
    if (this.cached && Date.now() - this.cached.at < 60_000) return this.cached.value;
    const envId = this.config.get<string>('GITHUB_APP_ID');
    const envKey = this.config.get<string>('GITHUB_APP_PRIVATE_KEY');
    let value: GithubAppCredentials | null = null;
    if (envId && envKey) {
      value = {
        appId: Number(envId),
        slug: this.config.get<string>('GITHUB_APP_SLUG') || '',
        // Env files usually hold the PEM on one line with literal "\n"s.
        privateKey: envKey.replace(/\\n/g, '\n'),
        webhookSecret: this.config.get<string>('GITHUB_APP_WEBHOOK_SECRET') || '',
      };
    } else {
      const row = await this.prisma.githubAppConfig.findUnique({ where: { id: 'default' } });
      if (row) {
        value = {
          appId: row.appId,
          slug: row.slug,
          privateKey: this.tokenCrypto.decrypt(row.privateKey),
          webhookSecret: this.tokenCrypto.decrypt(row.webhookSecret),
        };
      }
    }
    this.cached = { value, at: Date.now() };
    return value;
  }

  /** Forget cached credentials — after the app is (re)created. */
  reset() {
    this.cached = null;
    this.tokens.clear();
  }

  async requireCredentials(): Promise<GithubAppCredentials> {
    const creds = await this.credentials();
    if (!creds) throw new ServiceUnavailableException("The Audit Bench Ai GitHub App isn't set up yet.");
    return creds;
  }

  async appJwt(): Promise<string> {
    const creds = await this.requireCredentials();
    return signAppJwt(creds.appId, creds.privateKey);
  }

  appHeaders(jwt: string) {
    return {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'audit-bench-app',
    };
  }

  async installationToken(installationId: number): Promise<string> {
    const hit = this.tokens.get(installationId);
    if (hit && hit.expiresAt - 5 * 60_000 > Date.now()) return hit.token;
    const res = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
      method: 'POST',
      headers: this.appHeaders(await this.appJwt()),
    });
    if (!res.ok) throw gitHostRequestFailed('GitHub', res.status);
    const body = (await res.json()) as { token: string; expires_at: string };
    this.tokens.set(installationId, { token: body.token, expiresAt: new Date(body.expires_at).getTime() });
    return body.token;
  }

  /** The installation as GitHub describes it — account, repository selection, suspension. */
  async getInstallation(installationId: number): Promise<{
    id: number;
    account: { login: string; type: string };
    repository_selection: string;
    suspended_at: string | null;
  }> {
    const res = await fetch(`${GITHUB_API}/app/installations/${installationId}`, {
      headers: this.appHeaders(await this.appJwt()),
    });
    if (!res.ok) throw gitHostRequestFailed('GitHub', res.status);
    return res.json() as never;
  }
}
