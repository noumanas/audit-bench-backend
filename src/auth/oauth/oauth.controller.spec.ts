import { OAuthController } from './oauth.controller';

describe('OAuthController sign-in start', () => {
  const setup = () => {
    const oauthService = {
      redirectUri: (p: string) => `https://api.auditbenchai.com/auth/${p}/callback`,
      getAuthorizeUrl: (p: string, state: string) => `https://accounts.example/${p}?state=${state}`,
    };
    const controller = new OAuthController(oauthService as never, {} as never, { get: () => undefined } as never);
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
