import { AuthService } from './auth.service';

// No real DNS in unit tests: the email check has its own spec.
jest.mock('./email-domain', () => ({ unusableEmailReason: jest.fn().mockResolvedValue(null) }));
import { OAuthService } from './oauth/oauth.service';

const ADMIN = 'owner@acme.com';
const config = {
  get: (k: string) => ({ SUPER_ADMIN_EMAIL: ADMIN, JWT_SECRET: 'a-real-test-secret-value-0123456789' })[k],
};

describe('super_admin is never granted on an unverified email', () => {
  it('password signup with SUPER_ADMIN_EMAIL creates a normal user', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'u1', email: ADMIN, role: 'user', plan: {}, organization: null });
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null), create },
      plan: { findUnique: jest.fn().mockResolvedValue({ id: 'free' }) },
    };
    const auth = new AuthService(
      prisma as never,
      { sign: () => 'jwt' } as never,
      config as never,
      { send: jest.fn() } as never,
      { recordSignup: jest.fn(), log: jest.fn() } as never,
    );
    jest.spyOn(auth, 'buildSession').mockReturnValue({} as never);
    await auth.signup({ email: 'Owner@Acme.com', password: 'a-long-password-1', name: 'Mallory' } as never, {} as never);
    expect(create.mock.calls[0][0].data.role).toBe('user');
  });

  const oauthRole = async (provider: 'google' | 'github' | 'gitlab') => {
    const create = jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'u1', ...data }));
    const tx = {
      oAuthAccount: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue(null), create },
      plan: { findUnique: jest.fn().mockResolvedValue({ id: 'free' }) },
    };
    const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) };
    const service = new OAuthService(
      prisma as never,
      config as never,
      { encrypt: (v: string) => v } as never,
      { send: jest.fn() } as never,
    );
    await (service as any).findOrCreateUser(
      provider,
      { providerUserId: '1', username: 'owner', email: ADMIN },
      { accessToken: 't', refreshToken: null, expiresAt: null },
    );
    return create.mock.calls[0][0].data.role;
  };

  it('Google and GitHub sign-in (verified addresses) can bootstrap the admin', async () => {
    expect(await oauthRole('google')).toBe('super_admin');
    expect(await oauthRole('github')).toBe('super_admin');
  });

  it("GitLab sign-in doesn't, since its profile email isn't guaranteed verified", async () => {
    expect(await oauthRole('gitlab')).toBe('user');
  });
});
