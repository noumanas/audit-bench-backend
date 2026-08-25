import { GitlabService, mapGitlabContributorStats } from './gitlab.service';

/** GitLab's equivalent trust boundary — a plain shared-secret compare, not HMAC, so worth confirming it's still constant-time and correctly wired. */
describe('GitlabService.verifyWebhookToken', () => {
  it('accepts a matching token', () => {
    expect(GitlabService.verifyWebhookToken('my-secret', 'my-secret')).toBe(true);
  });

  it('rejects a non-matching token of the same length', () => {
    expect(GitlabService.verifyWebhookToken('my-secret', 'my-secre2')).toBe(false);
  });

  it('rejects a missing token header', () => {
    expect(GitlabService.verifyWebhookToken('my-secret', undefined)).toBe(false);
  });

  it('rejects a token of a different length without throwing', () => {
    expect(GitlabService.verifyWebhookToken('a-long-secret-value', 'short')).toBe(false);
  });
});

describe('mapGitlabContributorStats', () => {
  it('maps name/email/commits/additions/deletions and sorts by commits descending', () => {
    const raw = [
      { name: 'Low Committer', email: 'low@example.com', commits: 5, additions: 10, deletions: 2 },
      { name: 'High Committer', email: 'high@example.com', commits: 50, additions: 500, deletions: 100 },
    ];

    const stats = mapGitlabContributorStats(raw);
    expect(stats.map((s) => s.author)).toEqual(['High Committer', 'Low Committer']);
    expect(stats[0]).toEqual({
      author: 'High Committer',
      email: 'high@example.com',
      commits: 50,
      additions: 500,
      deletions: 100,
      lastCommitAt: null,
    });
  });

  it('falls back to email, then "unknown", when name is missing', () => {
    expect(mapGitlabContributorStats([{ commits: 1, email: 'a@b.com' }])[0].author).toBe('a@b.com');
    expect(mapGitlabContributorStats([{ commits: 1 }])[0].author).toBe('unknown');
  });

  it('drops malformed entries without a numeric commits field', () => {
    expect(mapGitlabContributorStats([{ name: 'no-commits-field' }])).toEqual([]);
  });
});
