import * as crypto from 'crypto';
import { GithubAppService } from './github-app.service';
import { signAppJwt } from '../github/github-app-auth.service';

// Same as pipeline.service.spec: the real Stage 1 module loads prettier's ESM-only build, which Jest can't run.
jest.mock('../audit/stage1/run-stage1', () => ({ runStage1: jest.fn() }));

const WEBHOOK_SECRET = 'app-webhook-secret';
const config = {
  get: (k: string) =>
    ({
      JWT_SECRET: 'a-real-test-secret-value',
      FRONTEND_ORIGIN: 'https://auditbenchai.com',
      BACKEND_ORIGIN: 'https://api.auditbenchai.com',
    })[k],
};

function setup(installation: unknown = null) {
  const prisma = {
    githubInstallation: {
      findUnique: jest.fn().mockResolvedValue(installation),
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      updateMany: jest.fn().mockResolvedValue(undefined),
      deleteMany: jest.fn().mockResolvedValue(undefined),
    },
    githubAppConfig: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findUniqueOrThrow: jest.fn() },
  };
  const appAuth = {
    credentials: jest
      .fn()
      .mockResolvedValue({ appId: 1, slug: 'audit-bench-ai', privateKey: 'k', webhookSecret: WEBHOOK_SECRET }),
    requireCredentials: jest
      .fn()
      .mockResolvedValue({ appId: 1, slug: 'audit-bench-ai', privateKey: 'k', webhookSecret: WEBHOOK_SECRET }),
    getInstallation: jest.fn().mockResolvedValue({
      id: 42,
      account: { login: 'acme', type: 'Organization' },
      repository_selection: 'all',
      suspended_at: null,
    }),
    reset: jest.fn(),
  };
  const webhooks = {
    alreadyReviewed: jest.fn().mockResolvedValue(false),
    autoReviewPullRequest: jest.fn().mockResolvedValue(undefined),
    recheckThread: jest.fn().mockResolvedValue(undefined),
    answerMention: jest.fn().mockResolvedValue(undefined),
  };
  const service = new GithubAppService(
    prisma as never,
    config as never,
    { decrypt: (s: string) => s } as never,
    appAuth as never,
    {} as never,
    webhooks as never,
  );
  return { service, prisma, appAuth, webhooks };
}

const deliver = (service: GithubAppService, event: string, body: object, secret = WEBHOOK_SECRET) => {
  const raw = Buffer.from(JSON.stringify(body));
  const sig = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  return service.handleWebhook(event, raw, body, sig);
};

const linked = { id: 42, autoReview: true, suspended: false, user: { id: 'u1', organizationId: null, isActive: true } };
const prBody = (over: object = {}) => ({
  action: 'opened',
  installation: { id: 42 },
  sender: { type: 'User' },
  repository: { full_name: 'acme/api' },
  pull_request: { number: 7, draft: false, head: { sha: 'abc' } },
  ...over,
});

describe('signAppJwt', () => {
  it('signs an RS256 app token GitHub can verify with the public key', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwt = signAppJwt(123, privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(), 1_000_000);
    const [h, p, sig] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({ iat: 999_940, exp: 1_000_540, iss: '123' });
    expect(crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, 'base64url'))).toBe(
      true,
    );
  });
});

describe('GithubAppService state', () => {
  it('round-trips a signed state, and rejects tampering, the wrong kind and expiry', () => {
    const { service } = setup();
    const state = service.signState('install', 'user-1', 1_000);
    expect(service.verifyState('install', state, 2_000)).toBe('user-1');
    expect(service.verifyState('manifest', state, 2_000)).toBeNull();
    expect(service.verifyState('install', state, 1_000 + 31 * 60_000)).toBeNull();
    const [body, mac] = state.split('.');
    const forged = Buffer.from(Buffer.from(body, 'base64url').toString().replace('user-1', 'user-2')).toString(
      'base64url',
    );
    expect(service.verifyState('install', `${forged}.${mac}`, 2_000)).toBeNull();
  });

  it('links an installation to whoever clicked Install, and asks to claim one installed from GitHub directly', async () => {
    const { service, prisma } = setup();
    const url = await service.handleSetup(42, service.signState('install', 'user-1'));
    expect(url).toBe('https://auditbenchai.com/app/repository?source=github&githubApp=installed');
    expect(prisma.githubInstallation.updateMany).toHaveBeenCalledWith({
      where: { id: 42, userId: null },
      data: { userId: 'user-1' },
    });
    expect(await service.handleSetup(42, undefined)).toBe(
      'https://auditbenchai.com/app/repository?source=github&githubApp=claim&installation=42',
    );
  });
});

describe('GithubAppService.claim', () => {
  it('lets the installed personal account claim it, and nobody else', async () => {
    const { service, prisma } = setup({ id: 42, accountLogin: 'Dev', accountType: 'User', userId: null });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ githubUsername: 'dev', githubToken: null });
    await service.claim('u1', 42);
    expect(prisma.githubInstallation.update).toHaveBeenCalledWith({ where: { id: 42 }, data: { userId: 'u1' } });

    prisma.user.findUniqueOrThrow.mockResolvedValue({ githubUsername: 'stranger', githubToken: null });
    await expect(service.claim('u2', 42)).rejects.toThrow(/Only @Dev can link/);
  });

  it("won't take an installation linked to someone else", async () => {
    const { service } = setup({ id: 42, accountLogin: 'acme', accountType: 'Organization', userId: 'other' });
    await expect(service.claim('u1', 42)).rejects.toThrow(/already linked/);
  });
});

describe('GithubAppService webhook', () => {
  it('rejects a bad signature', async () => {
    const { service } = setup(linked);
    await expect(deliver(service, 'pull_request', prBody(), 'wrong')).rejects.toThrow('Invalid webhook signature');
  });

  it('reviews a new pull request as the app, on the linked account', async () => {
    const { service, webhooks } = setup(linked);
    expect(await deliver(service, 'pull_request', prBody())).toEqual({ ok: true, status: 'reviewing' });
    expect(webhooks.autoReviewPullRequest).toHaveBeenCalledWith({ installationId: 42 }, linked.user, 'acme', 'api', 7, 'abc');
  });

  it('skips drafts, repeats, unlinked installs and auto-review switched off', async () => {
    expect(
      (await deliver(setup(linked).service, 'pull_request', prBody({ pull_request: { number: 7, draft: true } })))
        .skipped,
    ).toBe('draft PR');
    const repeat = setup(linked);
    repeat.webhooks.alreadyReviewed.mockResolvedValue(true);
    expect((await deliver(repeat.service, 'pull_request', prBody())).skipped).toBe('this commit was already reviewed');
    expect((await deliver(setup({ ...linked, user: null }).service, 'pull_request', prBody())).skipped).toMatch(
      /not linked/,
    );
    expect((await deliver(setup({ ...linked, autoReview: false }).service, 'pull_request', prBody())).skipped).toBe(
      'auto-review off',
    );
  });

  it('rechecks review-thread replies and answers mentions, but never reacts to bots', async () => {
    const { service, webhooks } = setup(linked);
    await deliver(service, 'pull_request_review_comment', {
      ...prBody(),
      action: 'created',
      comment: { id: 1, body: 'fixed' },
    });
    expect(webhooks.recheckThread).toHaveBeenCalledWith({ installationId: 42 }, 'u1', expect.anything());

    await deliver(service, 'issue_comment', {
      action: 'created',
      installation: { id: 42 },
      sender: { type: 'User' },
      repository: { full_name: 'acme/api' },
      issue: { number: 7, pull_request: {} },
      comment: { body: '@auditbench is this safe?' },
    });
    expect(webhooks.answerMention).toHaveBeenCalledWith(
      { installationId: 42 },
      'acme',
      'api',
      7,
      '@auditbench is this safe?',
    );

    const fromBot = await deliver(service, 'pull_request_review_comment', {
      ...prBody(),
      action: 'created',
      sender: { type: 'Bot' },
    });
    expect(fromBot.skipped).toBe('comment from a bot');
  });

  it('forgets an uninstalled installation', async () => {
    const { service, prisma } = setup(linked);
    await deliver(service, 'installation', { action: 'deleted', installation: { id: 42 } });
    expect(prisma.githubInstallation.deleteMany).toHaveBeenCalledWith({ where: { id: 42 } });
  });
});
