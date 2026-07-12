import * as crypto from 'crypto';
import { GithubService } from './github.service';

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
