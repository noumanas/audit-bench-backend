import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Campaign, isDeliverableAddress } from './campaign';
import { ehloNameFor } from './email.service';
import { InactivityEmailService } from './inactivity-email.service';
import { UnsubscribeService } from './unsubscribe.service';

describe('isDeliverableAddress', () => {
  it.each([
    'browser-test-1783503102628@example.com',
    'a@sub.example.org',
    'legacy@local',
    'public-scans@system.auditbenchai.local',
    'x@foo.test',
    'x@foo.invalid',
    'x@localhost',
  ])('rejects reserved test domain %s', (email) => expect(isDeliverableAddress(email)).toBe(false));

  it.each(['nouman@blacklionapp.xyz', 'someone@gmail.com', 'dev@example-company.com', 'a@testing.io'])(
    'accepts real address %s',
    (email) => expect(isDeliverableAddress(email)).toBe(true),
  );
});

describe('Campaign', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('tracks live progress, keeps going after a failure, and reports when done', async () => {
    const campaign = new Campaign('Test', new Logger('test'));
    const sendOne = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined);
    const done = campaign.execute([{ email: 'a@x.io' }, { email: 'b@x.io' }, { email: 'c@x.io' }], 'manual', sendOne);

    expect(campaign.running).toBe(true);
    await jest.runAllTimersAsync();
    const run = await done;

    expect(run).toMatchObject({ trigger: 'manual', eligible: 3, sent: 2, failed: 1 });
    expect(run.finishedAt).toBeInstanceOf(Date);
    expect(campaign.running).toBe(false);
    expect(campaign.lastRun).toBe(run);
  });
});

describe('InactivityEmailService.start (admin "Send now")', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 864e5);
  const user = (email: string) => ({
    id: email, email, name: null, createdAt: daysAgo(30), lastLoginAt: null, lastInactivityEmailAt: null, audits: [], scanJobs: [],
  });

  function make(users: ReturnType<typeof user>[], isConfigured = true) {
    const prisma = { user: { findMany: jest.fn().mockResolvedValue(users), update: jest.fn() } };
    const config = new ConfigService({ JWT_SECRET: 's' });
    const email = { isConfigured, send: jest.fn().mockResolvedValue(undefined) };
    const service = new InactivityEmailService(prisma as never, config, email as never, new UnsubscribeService(prisma as never, config));
    return { service, email };
  }

  it('skips test-domain accounts and starts sending in the background', async () => {
    const { service, email } = make([user('real@gmail.com'), user('debug-1@example.com'), user('legacy@local')]);
    await expect(service.start()).resolves.toEqual({ started: true, eligible: 1 });
    expect(service.status().running).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.send.mock.calls[0][0]).toBe('real@gmail.com');
  });

  it('refuses a second send while one is running, even on a double click', async () => {
    const { service } = make([user('a@gmail.com'), user('b@gmail.com')]);
    // Both requests in flight at once — the second must not start a second run.
    const [first, second] = await Promise.allSettled([service.start(), service.start()]);
    expect(first.status).toBe('fulfilled');
    expect(second).toMatchObject({ status: 'rejected', reason: expect.objectContaining({ message: 'This email is already being sent' }) });
    await expect(service.start()).rejects.toThrow('already being sent');
  });

  it('refuses when SMTP is not configured or nobody is eligible', async () => {
    await expect(make([user('a@gmail.com')], false).service.start()).rejects.toThrow('SMTP is not configured');
    await expect(make([]).service.start()).rejects.toThrow('Nobody is eligible');
  });
});

describe('ehloNameFor', () => {
  it('uses the sending account’s domain, never a container hostname', () => {
    expect(ehloNameFor('contact@auditbenchai.com')).toBe('auditbenchai.com');
    expect(ehloNameFor('no-at-sign')).toBeUndefined();
    expect(ehloNameFor('user@localhost')).toBeUndefined();
  });
});
