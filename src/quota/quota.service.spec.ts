import { ForbiddenException, HttpException } from '@nestjs/common';
import { QuotaService } from './quota.service';
import { PrismaService } from '../prisma/prisma.service';

function makeFakeDb(opts: {
  dailyLimit?: number | null;
  monthlyLimit?: number | null;
  usageCount?: number;
  repositoryScan?: boolean;
}) {
  const { dailyLimit = 5, monthlyLimit = 20, usageCount = 0, repositoryScan = true } = opts;
  return {
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'u1',
        plan: { name: 'Test', dailyAuditLimit: dailyLimit, monthlyAuditLimit: monthlyLimit, repositoryScan },
      }),
    },
    audit: { count: jest.fn().mockResolvedValue(usageCount) },
    scanJob: { count: jest.fn().mockResolvedValue(0) },
  };
}

/**
 * This is the whole billing boundary — get it wrong and either users get
 * blocked while under quota, or (worse) get free AI audits past their plan
 * limit. `withQuotaCheck`'s serializable-transaction race handling can't be
 * exercised without a real Postgres instance, but the limit-comparison
 * logic it wraps is fully unit-testable in isolation.
 */
describe('QuotaService.assertCanRunAudit', () => {
  it('allows a request comfortably under both daily and monthly limits', async () => {
    const quota = new QuotaService({} as PrismaService);
    const db = makeFakeDb({ dailyLimit: 5, usageCount: 2 });
    await expect(quota.assertCanRunAudit('u1', db as never)).resolves.toBeUndefined();
  });

  it('rejects with a 429 once usage has reached the daily limit', async () => {
    const quota = new QuotaService({} as PrismaService);
    const db = makeFakeDb({ dailyLimit: 5, usageCount: 5 });
    await expect(quota.assertCanRunAudit('u1', db as never)).rejects.toThrow(HttpException);
  });

  it('never rejects on an unlimited plan (null limit) no matter how high usage is', async () => {
    const quota = new QuotaService({} as PrismaService);
    const db = makeFakeDb({ dailyLimit: null, monthlyLimit: null, usageCount: 999_999 });
    await expect(quota.assertCanRunAudit('u1', db as never)).resolves.toBeUndefined();
  });
});

describe('QuotaService.assertPlanAllowsRepositoryScan', () => {
  it('throws Forbidden when the plan excludes repository scanning', async () => {
    const quota = new QuotaService({} as PrismaService);
    const db = makeFakeDb({ repositoryScan: false });
    await expect(quota.assertPlanAllowsRepositoryScan('u1', db as never)).rejects.toThrow(ForbiddenException);
  });

  it('passes when the plan includes repository scanning', async () => {
    const quota = new QuotaService({} as PrismaService);
    const db = makeFakeDb({ repositoryScan: true });
    await expect(quota.assertPlanAllowsRepositoryScan('u1', db as never)).resolves.toBeUndefined();
  });
});
