import * as crypto from 'crypto';
import { GithubService, explainPostFailure, mapGithubContributorStats } from './github.service';

/**
 * This check is the entire trust boundary for the webhook receiver — every
 * "reply to a PR comment" action downstream assumes a payload that passed
 * this is genuinely from GitHub. A bug here is a spoofed-webhook bug.
 */
describe('GithubService.verifyWebhookSignature', () => {
  const secret = 'test-secret';

  function sign(body: string, withSecret = secret): string {
    return `sha256=${crypto.createHmac('sha256', withSecret).update(body).digest('hex')}`;
  }

  it('accepts a correctly signed payload', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    expect(GithubService.verifyWebhookSignature(secret, body, sign(body.toString()))).toBe(true);
  });

  it('rejects a payload signed with the wrong secret', () => {
    const body = Buffer.from(JSON.stringify({ hello: 'world' }));
    expect(GithubService.verifyWebhookSignature(secret, body, sign(body.toString(), 'wrong-secret'))).toBe(false);
  });

  it('rejects a tampered body even with a signature valid for the original body', () => {
    const signature = sign('original-body');
    const tamperedBody = Buffer.from('tampered-body');
    expect(GithubService.verifyWebhookSignature(secret, tamperedBody, signature)).toBe(false);
  });

  it('rejects a missing signature header', () => {
    expect(GithubService.verifyWebhookSignature(secret, Buffer.from('x'), undefined)).toBe(false);
  });

  it('rejects a malformed signature header missing the sha256= prefix', () => {
    expect(GithubService.verifyWebhookSignature(secret, Buffer.from('x'), 'deadbeef')).toBe(false);
  });
});

describe('mapGithubContributorStats', () => {
  it('sums weekly additions/deletions and reports the most recent active week', () => {
    const raw = [
      {
        total: 42,
        author: { login: 'octocat' },
        weeks: [
          { w: 1_600_000_000, a: 100, d: 20, c: 5 },
          { w: 1_600_604_800, a: 0, d: 0, c: 0 }, // quiet week — should not be picked as "last active"
          { w: 1_601_209_600, a: 50, d: 10, c: 3 },
        ],
      },
    ];

    const [stat] = mapGithubContributorStats(raw);
    expect(stat).toEqual({
      author: 'octocat',
      commits: 42,
      additions: 150,
      deletions: 30,
      lastCommitAt: new Date(1_601_209_600 * 1000).toISOString(),
    });
  });

  it('falls back to "unknown" when GitHub could not match the commit author to an account', () => {
    const raw = [{ total: 3, author: null, weeks: [] }];
    expect(mapGithubContributorStats(raw)[0].author).toBe('unknown');
  });

  it('sorts by commit count descending and drops malformed entries', () => {
    const raw = [
      { total: 5, author: { login: 'low' }, weeks: [] },
      { total: 50, author: { login: 'high' }, weeks: [] },
      { notAnEntry: true },
    ];
    expect(mapGithubContributorStats(raw).map((s) => s.author)).toEqual(['high', 'low']);
  });
});

describe('GithubService.publish', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('posts multi-line inline comments inside the diff and drops ones outside it', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return { ok: true, json: async () => ({}) };
    }) as never;
    const service = new GithubService(
      { user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ githubToken: 'enc' }) } } as never,
      { register: jest.fn() } as never,
      { decrypt: () => 'token' } as never,
      {} as never,
    );

    await service.publish(
      'u1',
      { kind: 'github', owner: 'acme', repo: 'api', pullNumber: 7, headSha: 'sha', headRef: 'f', baseRef: 'main' },
      {
        verdict: 'needs_work',
        summary: 's',
        changedRanges: { 'src/a.ts': [{ start: 220, end: 260 }] },
        findings: [
          { path: 'src/a.ts', line: 233, endLine: 235, severity: 'medium', title: 'Range', description: 'd' },
          { path: 'src/a.ts', line: 240, severity: 'high', title: 'Single', description: 'd' },
          { path: 'src/a.ts', line: 10, severity: 'low', title: 'Outside the diff', description: 'd' },
        ],
      },
    );

    const review = calls.find((c) => c.url.endsWith('/pulls/7/reviews'))!.body;
    expect(review.comments).toHaveLength(2);
    expect(review.comments[0]).toMatchObject({ path: 'src/a.ts', start_line: 233, start_side: 'RIGHT', line: 235, side: 'RIGHT' });
    expect(review.comments[1]).toMatchObject({ line: 240, side: 'RIGHT' });
    expect(review.comments[1].start_line).toBeUndefined();
    expect(review.comments[0].body).toContain('**🟡 Medium**\n\n**Range**');
  });
});

describe('GithubService.publish when GitHub refuses', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('throws an explained error instead of failing silently', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Resource not accessible by personal access token' }),
    })) as never;
    const service = new GithubService(
      { user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ githubToken: 'enc' }) } } as never,
      { register: jest.fn() } as never,
      { decrypt: () => 'token' } as never,
      {} as never,
    );
    await expect(
      service.publish(
        'u1',
        { kind: 'github', owner: 'Netflix', repo: 'dgs-framework', pullNumber: 2363, headSha: 's', headRef: 'f', baseRef: 'master' },
        { verdict: 'pass', summary: 's', findings: [] },
      ),
    ).rejects.toThrow(/classic token that has the public_repo scope/);
  });

  it('explains other refusals', () => {
    expect(explainPostFailure(401, 'Bad credentials')).toMatch(/expired or been revoked/);
    expect(explainPostFailure(404, 'Not Found')).toMatch(/can't write to this repository/);
    expect(explainPostFailure(422, 'Validation Failed')).toBe('GitHub refused the comment (422: Validation Failed).');
  });
});
