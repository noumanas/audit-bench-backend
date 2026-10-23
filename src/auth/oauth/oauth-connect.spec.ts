import { OAuthService } from './oauth.service';

describe('OAuthService connecting GitHub/GitLab to a signed-in account', () => {
  const env: Record<string, string> = {
    JWT_SECRET: 'a-real-test-secret-value-0123456789',
    GITHUB_OAUTH_CLIENT_ID: 'gh-client',
    GITLAB_OAUTH_CLIENT_ID: 'gl-client',
    BACKEND_ORIGIN: 'https://api.auditbenchai.com',
  };
  const setup = () => {
    const prisma = { user: { update: jest.fn() }, oAuthAccount: { findUnique: jest.fn(), create: jest.fn() } };
    const service = new OAuthService(prisma as never, { get: (k: string) => env[k] } as never, {} as never);
    return { service, prisma };
  };
  const stateOf = (url: string) => new URL(url).searchParams.get('state') as string;

  it("sends the user to GitHub's consent page with a signed connect state", () => {
    const { service } = setup();
    const url = new URL(service.connectUrl('github', 'user-1'));
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.auditbenchai.com/auth/github/callback');
    const state = url.searchParams.get('state') as string;
    expect(service.isConnectState(state)).toBe(true);
    expect(service.verifyConnectState('github', state)).toBe('user-1');
  });

  it('rejects a state that is tampered with, expired, or for another provider', () => {
    const { service } = setup();
    const now = Date.now();
    const state = stateOf(service.connectUrl('github', 'user-1', now));
    expect(service.verifyConnectState('gitlab', state, now)).toBeNull();
    expect(service.verifyConnectState('github', state, now + 11 * 60_000)).toBeNull();
    const [prefix, mac] = [state.slice(0, state.lastIndexOf('.')), state.slice(state.lastIndexOf('.') + 1)];
    const forged = `connect.${Buffer.from(`github.attacker.${now + 60_000}`).toString('base64url')}.${mac}`;
    expect(service.verifyConnectState('github', forged, now)).toBeNull();
    expect(service.verifyConnectState('github', `${prefix}.x${mac.slice(1)}`, now)).toBeNull();
    // A plain sign-in state is never mistaken for a connect one.
    expect(service.isConnectState('a3f9c0de11223344556677889900aabb')).toBe(false);
  });

  it("won't attach a token to a different account than the one that started the connection", async () => {
    const { service, prisma } = setup();
    const fetchSpy = jest.spyOn(global, 'fetch');
    const attackersState = stateOf(service.connectUrl('github', 'attacker'));
    await expect(service.connectAccount('victim', 'github', 'code', attackersState)).rejects.toThrow(
      /started from another account/,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
