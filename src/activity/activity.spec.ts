import { ConfigService } from '@nestjs/config';
import { requestContext } from './request-context';
import { signupSource } from './attribution';
import { ActivityService, formatLocation } from './activity.service';
import { AuthService } from '../auth/auth.service';
import { OAuthController } from '../auth/oauth/oauth.controller';

jest.mock('../auth/email-domain', () => ({ unusableEmailReason: jest.fn().mockResolvedValue(null) }));

const req = (ip: string, headers: Record<string, string> = {}) => ({ ip, headers, socket: {} }) as never;

describe('requestContext', () => {
  it('resolves the country from an IPv4 address, including IPv4-mapped IPv6', () => {
    expect(requestContext(req('::ffff:8.8.8.8', { 'user-agent': 'Mozilla/5.0' }), false)).toEqual({
      ip: '8.8.8.8',
      userAgent: 'Mozilla/5.0',
      countryCode: 'US',
      region: null,
      city: null,
    });
  });

  it('leaves private and IPv6 addresses without a country', () => {
    expect(requestContext(req('127.0.0.1'), false).countryCode).toBeNull();
    expect(requestContext(req('2a03:2880:f12f:83:face:b00c:0:25de'), false).countryCode).toBeNull();
  });

  it('ignores edge geo headers unless TRUST_GEO_HEADERS is on, since clients can forge them', () => {
    const headers = { 'cf-ipcountry': 'pk', 'cf-ipcity': 'Lahore', 'cf-region': 'Punjab' };
    expect(requestContext(req('8.8.8.8', headers), false)).toMatchObject({ countryCode: 'US', city: null });
    expect(requestContext(req('8.8.8.8', headers), true)).toMatchObject({
      countryCode: 'PK',
      region: 'Punjab',
      city: 'Lahore',
    });
  });

  it('decodes Vercel city names and drops "unknown" country codes', () => {
    const ctx = requestContext(req('10.0.0.1', { 'x-vercel-ip-country': 'XX', 'x-vercel-ip-city': 'S%C3%A3o%20Paulo' }), true);
    expect(ctx).toMatchObject({ countryCode: null, city: 'São Paulo' });
  });
});

describe('signupSource', () => {
  const own = ['https://auditbenchai.com', 'http://localhost:3000'];
  it('prefers utm_source, then the referring host, then "direct"', () => {
    expect(signupSource({ utmSource: 'ProductHunt', referrer: 'https://google.com/' }, own)).toBe('producthunt');
    expect(signupSource({ referrer: 'https://www.google.com/search?q=x' }, own)).toBe('google.com');
    expect(signupSource({ referrer: 'not a url' }, own)).toBe('direct');
    expect(signupSource(undefined, own)).toBe('direct');
  });

  it('treats a referrer from our own site as direct', () => {
    expect(signupSource({ referrer: 'https://www.auditbenchai.com/pricing' }, own)).toBe('direct');
  });
});

describe('formatLocation', () => {
  it('joins whatever parts are known', () => {
    expect(formatLocation({ city: 'Lahore', region: 'Punjab', countryCode: 'PK' })).toBe('Lahore, Punjab, PK');
    expect(formatLocation({ countryCode: 'US' })).toBe('US');
    expect(formatLocation({})).toBeNull();
  });
});

describe('ActivityService.recordSignup', () => {
  const setup = (env: Record<string, string> = {}) => {
    const prisma = { user: { update: jest.fn().mockResolvedValue({}) }, activityLog: { create: jest.fn().mockResolvedValue({}) } };
    const email = { send: jest.fn().mockResolvedValue(undefined) };
    const service = new ActivityService(prisma as never, new ConfigService(env), email as never);
    return { service, prisma, email };
  };
  const ctx = { ip: '8.8.8.8', userAgent: 'UA', countryCode: 'US', region: null, city: null };

  it('stamps attribution on the user, logs the signup and emails the team inbox', async () => {
    const { service, prisma, email } = setup();
    await service.recordSignup({ id: 'u1', email: 'a@x.com', name: 'A' }, 'github', ctx, {
      referrer: 'https://news.ycombinator.com/item?id=1',
      utmCampaign: 'launch',
    });
    expect(prisma.user.update.mock.calls[0][0].data).toEqual({
      signupMethod: 'github',
      signupSource: 'news.ycombinator.com',
      signupCampaign: 'launch',
      signupCountry: 'US',
      signupRegion: null,
      signupCity: null,
    });
    expect(prisma.activityLog.create.mock.calls[0][0].data).toMatchObject({
      type: 'signup',
      userId: 'u1',
      method: 'github',
      ip: '8.8.8.8',
      countryCode: 'US',
    });
    expect(email.send.mock.calls[0][0]).toBe('hello@auditbenchai.com');
  });

  it('respects ADMIN_NOTIFY_INBOX and SIGNUP_NOTIFY_EMAILS=false', async () => {
    const custom = setup({ ADMIN_NOTIFY_INBOX: 'team@acme.com' });
    await custom.service.recordSignup({ id: 'u1', email: 'a@x.com', name: null }, 'password', ctx);
    expect(custom.email.send.mock.calls[0][0]).toBe('team@acme.com');

    const off = setup({ SIGNUP_NOTIFY_EMAILS: 'false' });
    await off.service.recordSignup({ id: 'u1', email: 'a@x.com', name: null }, 'password', ctx);
    expect(off.email.send).not.toHaveBeenCalled();
    expect(off.prisma.activityLog.create).toHaveBeenCalled();
  });

  it('never throws when the database or mail fails', async () => {
    const { service, prisma, email } = setup();
    prisma.user.update.mockRejectedValue(new Error('db down'));
    prisma.activityLog.create.mockRejectedValue(new Error('db down'));
    email.send.mockRejectedValue(new Error('smtp down'));
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    await expect(service.recordSignup({ id: 'u1', email: 'a@x.com', name: null }, 'password', ctx)).resolves.toBeUndefined();
  });
});

describe('AuthService.login activity', () => {
  const ctx = { ip: '1.2.3.4', userAgent: null, countryCode: null, region: null, city: null };
  const setup = (user: unknown) => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user), update: jest.fn().mockResolvedValue({}) } };
    const activity = { log: jest.fn().mockResolvedValue(undefined), recordSignup: jest.fn() };
    const auth = new AuthService(prisma as never, { sign: () => 'jwt' } as never, new ConfigService({}), {} as never, activity as never);
    return { auth, activity };
  };

  it('logs a failed sign-in for an unknown email, without a user id', async () => {
    const { auth, activity } = setup(null);
    await expect(auth.login({ email: 'ghost@x.com', password: 'whatever-123' }, ctx)).rejects.toThrow();
    expect(activity.log).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'login_failed', userId: undefined, email: 'ghost@x.com', metadata: { reason: 'unknown_email' } }),
    );
  });

  it('logs a failed sign-in for a wrong password against the account', async () => {
    const bcrypt = await import('bcryptjs');
    const { auth, activity } = setup({ id: 'u1', email: 'a@x.com', passwordHash: await bcrypt.hash('right-password', 4) });
    await expect(auth.login({ email: 'a@x.com', password: 'wrong-password' }, ctx)).rejects.toThrow();
    expect(activity.log).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'login_failed', userId: 'u1', metadata: { reason: 'wrong_password' } }),
    );
  });
});

describe('OAuthController.exchange activity', () => {
  const user = {
    id: 'u1', email: 'a@x.com', name: 'A', createdAt: new Date(), plan: {}, role: 'user',
    isActive: true, organizationId: null, orgRole: null, organization: null,
  };
  const run = async (isNewUser: boolean) => {
    const oauthService = { exchangeLoginCode: jest.fn().mockResolvedValue({ user, provider: 'google', isNewUser }) };
    const authService = { buildSession: jest.fn().mockReturnValue({ accessToken: 'jwt' }) };
    const activity = { context: jest.fn().mockReturnValue({ ip: '8.8.8.8' }), log: jest.fn(), recordSignup: jest.fn() };
    const controller = new OAuthController(oauthService as never, authService as never, {} as never, activity as never);
    const attribution = { utmSource: 'twitter' };
    await expect(controller.exchange({ code: 'c', attribution }, {} as never)).resolves.toEqual({ accessToken: 'jwt' });
    return { activity, attribution };
  };

  it('records a signup with attribution when the sign-in created the account', async () => {
    const { activity, attribution } = await run(true);
    expect(activity.recordSignup).toHaveBeenCalledWith(user, 'google', { ip: '8.8.8.8' }, attribution);
    expect(activity.log).not.toHaveBeenCalled();
  });

  it('logs a plain sign-in for a returning user', async () => {
    const { activity } = await run(false);
    expect(activity.log).toHaveBeenCalledWith(expect.objectContaining({ type: 'login', method: 'google', userId: 'u1' }));
    expect(activity.recordSignup).not.toHaveBeenCalled();
  });
});
