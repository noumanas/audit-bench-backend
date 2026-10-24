import { ConfigService } from '@nestjs/config';
import { UpgradeEmailService } from './upgrade-email.service';
import { UnsubscribeService } from './unsubscribe.service';
import { orgInviteEmail, upgradeEmail } from './templates';

const plan = (name: string, cents: number, audits: number | null, repos: number | null, scans: number | null) => ({
  name,
  priceMonthlyCents: cents,
  monthlyAuditLimit: audits,
  maxRepositories: repos,
  monthlyRepoScanLimit: scans,
});

function makeService(users: { id: string; email: string; name: string | null }[] = []) {
  const prisma = {
    user: { findMany: jest.fn().mockResolvedValue(users), update: jest.fn(), updateMany: jest.fn() },
  };
  const config = new ConfigService({ JWT_SECRET: 'test-secret', BACKEND_ORIGIN: 'https://api.example.com' });
  const email = { isConfigured: true, send: jest.fn() };
  const unsubscribe = new UnsubscribeService(prisma as never, config);
  const service = new UpgradeEmailService(prisma as never, config, email as never, {} as never, unsubscribe);
  return { service, prisma, email, unsubscribe };
}

describe('UpgradeEmailService', () => {
  it('only targets active, opted-in, personal Free accounts not emailed in the last 6 days', async () => {
    const { service, prisma } = makeService();
    const now = new Date('2026-10-26T10:00:00Z');
    await service.run({ dryRun: true, now });

    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      isActive: true,
      marketingEmails: true,
      organizationId: null,
      plan: { slug: 'free' },
    });
    expect(where.OR[1].lastUpgradeEmailAt.lt).toEqual(new Date('2026-10-20T10:00:00Z'));
  });

  it('dry run lists recipients without sending', async () => {
    const { service, email } = makeService([{ id: 'u1', email: 'a@example.com', name: null }]);
    const result = await service.run({ dryRun: true });
    expect(result).toMatchObject({ eligible: 1, sent: 0, recipients: ['a@example.com'] });
    expect(email.send).not.toHaveBeenCalled();
  });

  it('accepts its own unsubscribe token and rejects one for another user', () => {
    const { unsubscribe } = makeService();
    const token = unsubscribe.token('user-1');
    expect(unsubscribe.verify('user-1', token)).toBe(true);
    expect(unsubscribe.verify('user-2', token)).toBe(false);
    expect(unsubscribe.verify('user-1', 'nope')).toBe(false);
  });
});

describe('email templates', () => {
  it('escapes user-supplied names in the HTML but not the plain text', () => {
    const msg = orgInviteEmail({ inviterName: '<script>x</script>', orgName: 'A & B', acceptUrl: 'https://x/invite/t' });
    expect(msg.html).not.toContain('<script>x</script>');
    expect(msg.html).toContain('&lt;script&gt;');
    expect(msg.html).toContain('A &amp; B');
    expect(msg.text).toContain('A & B');
  });

  it('builds the upgrade comparison from plan limits', () => {
    const msg = upgradeEmail({
      name: 'Sam',
      free: plan('Free', 0, 20, 1, 1),
      pro: plan('Pro', 2900, 500, null, 3),
      pricingUrl: 'https://app/pricing',
      unsubscribeUrl: 'https://api/email/unsubscribe?u=1&t=2',
      auditsUsed: 18,
      auditLimit: 20,
    });
    expect(msg.subject).toBe('Get more out of Audit Bench Ai with Pro');
    expect(msg.html).toContain('Pro · $29/mo');
    expect(msg.html).toContain('Unlimited');
    expect(msg.html).toContain('<strong>18 of 20</strong>');
    expect(msg.text).toContain('Unsubscribe: https://api/email/unsubscribe?u=1&t=2');
  });
});
