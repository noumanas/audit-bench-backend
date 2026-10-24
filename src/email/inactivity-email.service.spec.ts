import { ConfigService } from '@nestjs/config';
import { InactivityEmailService } from './inactivity-email.service';
import { UnsubscribeService } from './unsubscribe.service';
import { inactivityEmail } from './templates';

const NOW = new Date('2026-10-24T11:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'dev@example.com',
    name: 'Dev',
    createdAt: daysAgo(60),
    lastLoginAt: daysAgo(10),
    lastInactivityEmailAt: null,
    audits: [],
    scanJobs: [],
    ...overrides,
  };
}

function makeService(candidates: ReturnType<typeof candidate>[]) {
  const prisma = { user: { findMany: jest.fn().mockResolvedValue(candidates), update: jest.fn() } };
  const config = new ConfigService({ JWT_SECRET: 's', FRONTEND_ORIGIN: 'https://app.example.com' });
  const email = { isConfigured: true, send: jest.fn().mockResolvedValue(undefined) };
  const service = new InactivityEmailService(prisma as never, config, email as never, new UnsubscribeService(prisma as never, config));
  return { service, prisma, email };
}

describe('InactivityEmailService', () => {
  it('queries for opted-in accounts with no sign-in, audit or scan in the last 7 days', async () => {
    const { service, prisma } = makeService([]);
    await service.findInactive(NOW);
    const where = prisma.user.findMany.mock.calls[0][0].where;
    const cutoff = daysAgo(7);
    expect(where).toMatchObject({
      isActive: true,
      marketingEmails: true,
      createdAt: { lt: cutoff },
      audits: { none: { createdAt: { gte: cutoff } } },
      scanJobs: { none: { createdAt: { gte: cutoff } } },
    });
    expect(where.OR).toEqual([{ lastLoginAt: null }, { lastLoginAt: { lt: cutoff } }]);
  });

  it('counts days from the most recent of sign-in, audit and scan', async () => {
    const { service } = makeService([
      candidate({ lastLoginAt: daysAgo(30), audits: [{ createdAt: daysAgo(9) }], scanJobs: [{ createdAt: daysAgo(20) }] }),
    ]);
    const [user] = await service.findInactive(NOW);
    expect(user.daysInactive).toBe(9);
  });

  it('sends once per inactive stretch', async () => {
    const { service } = makeService([
      // Already emailed after their last activity — still the same stretch.
      candidate({ id: 'same', lastLoginAt: daysAgo(20), lastInactivityEmailAt: daysAgo(12) }),
      // Came back after the last email, then went quiet again — new stretch.
      candidate({ id: 'again', lastLoginAt: daysAgo(8), lastInactivityEmailAt: daysAgo(30) }),
    ]);
    const ids = (await service.findInactive(NOW)).map((u) => u.id);
    expect(ids).toEqual(['again']);
  });

  it('dry run sends nothing; a real run sends with unsubscribe headers and records the send', async () => {
    const dry = makeService([candidate()]);
    expect(await dry.service.run({ dryRun: true, now: NOW })).toMatchObject({ eligible: 1, sent: 0 });
    expect(dry.email.send).not.toHaveBeenCalled();

    const live = makeService([candidate()]);
    const result = await live.service.run({ now: NOW });
    expect(result).toMatchObject({ eligible: 1, sent: 1, failed: 0 });
    const [to, subject, , , headers] = live.email.send.mock.calls[0];
    expect(to).toBe('dev@example.com');
    expect(subject).toBe('Your code reviews are waiting on Audit Bench Ai');
    expect(headers['List-Unsubscribe']).toMatch(/^<.*\/email\/unsubscribe\?u=u1&t=[0-9a-f]{64}>$/);
    expect(live.prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { lastInactivityEmailAt: expect.any(Date) },
    });
  });

  it('a failed send is counted and does not record the user as emailed', async () => {
    const { service, email, prisma } = makeService([candidate()]);
    email.send.mockRejectedValueOnce(new Error('535 auth'));
    expect(await service.run({ now: NOW })).toMatchObject({ sent: 0, failed: 1 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('inactivityEmail template', () => {
  it('links into the app and includes the days count and unsubscribe link', () => {
    const msg = inactivityEmail({ name: 'A <b>', daysInactive: 9, appOrigin: 'https://app.x', unsubscribeUrl: 'https://api.x/u' });
    expect(msg.html).toContain('<strong>9 days</strong>');
    expect(msg.html).toContain('href="https://app.x/app/repository"');
    expect(msg.html).toContain('A &lt;b&gt;');
    expect(msg.text).toContain('Unsubscribe: https://api.x/u');
  });
});
