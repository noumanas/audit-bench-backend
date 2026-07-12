import { GitlabService } from './gitlab.service';

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
