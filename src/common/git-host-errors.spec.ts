import { GIT_TOKEN_REJECTED, gitHostRequestFailed } from './git-host-errors';

describe('gitHostRequestFailed', () => {
  it('tags a 401 so the UI asks for a new token, and never answers 401 itself', () => {
    const err = gitHostRequestFailed('GitHub', 401);
    expect(err.getStatus()).toBe(400);
    expect(err.getResponse()).toMatchObject({ scope: GIT_TOKEN_REJECTED, statusCode: 400 });
    expect((err.getResponse() as { message: string }).message).toMatch(/expired or been revoked/);
  });

  it('leaves other failures untagged', () => {
    const err = gitHostRequestFailed('GitLab', 502);
    expect(err.getStatus()).toBe(400);
    expect(JSON.stringify(err.getResponse())).not.toContain(GIT_TOKEN_REJECTED);
    expect(err.message).toBe('GitLab rejected the request (502)');
  });
});
