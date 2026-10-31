import { ConflictException } from '@nestjs/common';
import { OAuthController } from './oauth.controller';

describe('OAuthController sign-in start', () => {
  const setup = () => {
    const oauthService = {
      redirectUri: (p: string) => `https://api.auditbenchai.com/auth/${p}/callback`,
      getAuthorizeUrl: (p: string, state: string) => `https://accounts.example/${p}?state=${state}`,
    };
    const controller = new OAuthController(oauthService as never, {} as never, { get: () => undefined } as never, {} as never);
    const res = { cookie: jest.fn(), redirect: jest.fn() };
    return { controller, res };
  };
  const req = (host: string) => ({ get: (h: string) => (h === 'host' ? host : undefined) });

  it('hops to the callback host first when sign-in starts on another address', () => {
    const { controller, res } = setup();
    controller.googleAuthorize(req('audit-bench-backend-git-1.europe-west1.run.app') as never, res as never);
    expect(res.redirect).toHaveBeenCalledWith('https://api.auditbenchai.com/auth/google');
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('sets the state cookie and goes to the provider on the callback host', () => {
    const { controller, res } = setup();
    controller.googleAuthorize(req('api.auditbenchai.com') as never, res as never);
    const state = res.cookie.mock.calls[0][1];
    expect(res.cookie).toHaveBeenCalledWith('oauth_state', state, expect.objectContaining({ httpOnly: true }));
    expect(res.redirect).toHaveBeenCalledWith(`https://accounts.example/google?state=${state}`);
  });

  it('applies to GitHub and GitLab sign-in too', () => {
    const { controller, res } = setup();
    controller.githubAuthorize(req('other.run.app') as never, res as never);
    controller.gitlabAuthorize(req('other.run.app') as never, res as never);
    expect(res.redirect.mock.calls.map((c) => c[0])).toEqual([
      'https://api.auditbenchai.com/auth/github',
      'https://api.auditbenchai.com/auth/gitlab',
    ]);
  });
});

describe('OAuthController sign-in callback errors', () => {
  const callback = async (error: Error) => {
    const oauthService = { isConnectState: () => false, handleCallback: jest.fn().mockRejectedValue(error) };
    const controller = new OAuthController(
      oauthService as never,
      {} as never,
      { get: () => 'https://app.example' } as never,
      {} as never,
    );
    jest.spyOn((controller as any).logger, 'error').mockImplementation(() => undefined);
    const res = { clearCookie: jest.fn(), redirect: jest.fn() };
    const req = { cookies: { oauth_state: 's1' } };
    await controller.githubCallback(req as never, 'code', 's1', res as never);
    return decodeURIComponent(String(res.redirect.mock.calls[0][0]).split('error=')[1]);
  };

  it('shows messages written for the user', async () => {
    expect(await callback(new ConflictException('An account already exists for a@b.com.'))).toBe(
      'An account already exists for a@b.com.',
    );
  });

  it('never puts internal error details in the URL', async () => {
    const shown = await callback(new Error('connect ECONNREFUSED 10.0.0.5:5432 (prisma)'));
    expect(shown).toBe('Sign-in failed. Please try again.');
    expect(shown).not.toContain('5432');
  });
});
