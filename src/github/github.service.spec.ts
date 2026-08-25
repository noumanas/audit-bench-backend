import * as crypto from 'crypto';
import { GithubService, mapGithubContributorStats } from './github.service';

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
