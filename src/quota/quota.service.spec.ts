import { ForbiddenException, HttpException } from '@nestjs/common';
import { QuotaService } from './quota.service';
import { PrismaService } from '../prisma/prisma.service';

function makeFakeDb(opts: {
  dailyLimit?: number | null;
  monthlyLimit?: number | null;
  usageCount?: number;
  repositoryScan?: boolean;
  maxRepositories?: number | null;
  priorScans?: { sourceName: string; repoRef?: unknown; prContext?: unknown }[];
  alignmentLabEnabled?: boolean;
  monthlyInvestigationLimit?: number | null;
  investigationUsageCount?: number;
}) {
  const {
    dailyLimit = 5,
    monthlyLimit = 20,
    usageCount = 0,
    repositoryScan = true,
    maxRepositories = null,
    priorScans = [],
    alignmentLabEnabled = false,
    monthlyInvestigationLimit = null,
    investigationUsageCount = 0,
  } = opts;
  return {
    user: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        id: 'u1',
        plan: {
          name: 'Test',
          dailyAuditLimit: dailyLimit,
          monthlyAuditLimit: monthlyLimit,
          repositoryScan,
          maxRepositories,
          alignmentLabEnabled,
          monthlyInvestigationLimit,
        },
      }),
    },
    audit: { count: jest.fn().mockResolvedValue(usageCount) },
    scanJob: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue(priorScans) },
    investigation: { count: jest.fn().mockResolvedValue(investigationUsageCount) },
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

describe('QuotaService.assertCanScanNewRepository', () => {
  it('throws Forbidden when the plan excludes repository scanning outright', async () => {
    const quota = new QuotaService({} as PrismaService);
    const db = makeFakeDb({ repositoryScan: false });
    await expect(quota.assertCanScanNewRepository('u1', 'github:o/r', db as never)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('allows a first repository on a plan capped at one (e.g. Free)', async () => {
    const quota = new QuotaService({} as PrismaService);
    const db = makeFakeDb({ repositoryScan: true, maxRepositories: 1, priorScans: [] });
    await expect(quota.assertCanScanNewRepository('u1', 'github:o/r', db as never)).resolves.toBeUndefined();
  });

  it('allows re-scanning (or reviewing another PR against) the same repo already counted', async () => {
    const quota = new QuotaService({} as PrismaService);
    const db = makeFakeDb({
      repositoryScan: true,
      maxRepositories: 1,
      priorScans: [{ sourceName: 'o/r', repoRef: { kind: 'github', owner: 'o', repo: 'r' } }],
    });
    await expect(quota.assertCanScanNewRepository('u1', 'github:o/r', db as never)).resolves.toBeUndefined();
  });

  it('blocks a second, different repository once the cap is reached', async () => {
    const quota = new QuotaService({} as PrismaService);
    const db = makeFakeDb({
      repositoryScan: true,
      maxRepositories: 1,
      priorScans: [{ sourceName: 'o/r', repoRef: { kind: 'github', owner: 'o', repo: 'r' } }],
    });
    await expect(quota.assertCanScanNewRepository('u1', 'github:o/other', db as never)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('never blocks on an unlimited plan (null maxRepositories) no matter how many prior scans', async () => {
    const quota = new QuotaService({} as PrismaService);
    const db = makeFakeDb({
      repositoryScan: true,
      maxRepositories: null,
      priorScans: [{ sourceName: 'a' }, { sourceName: 'b' }, { sourceName: 'c' }],
    });
    await expect(quota.assertCanScanNewRepository('u1', 'zip:d', db as never)).resolves.toBeUndefined();
  });
});

describe('QuotaService.assertCanRunInvestigation', () => {
  it('throws Forbidden when the plan excludes Alignment Lab', async () => {
    const quota = new QuotaService({} as PrismaService);
    const db = makeFakeDb({ alignmentLabEnabled: false });
    await expect(quota.assertCanRunInvestigation('u1', 'user', db as never)).rejects.toThrow(ForbiddenException);
  });

  it('passes when the plan includes it and usage is under the monthly limit', async () => {
    const quota = new QuotaService({} as PrismaService);
    const db = makeFakeDb({ alignmentLabEnabled: true, monthlyInvestigationLimit: 20, investigationUsageCount: 5 });
    await expect(quota.assertCanRunInvestigation('u1', 'user', db as never)).resolves.toBeUndefined();
  });

  it('rejects with a 429 once monthly investigation usage hits the limit', async () => {
    const quota = new QuotaService({} as PrismaService);
    const db = makeFakeDb({ alignmentLabEnabled: true, monthlyInvestigationLimit: 20, investigationUsageCount: 20 });
    await expect(quota.assertCanRunInvestigation('u1', 'user', db as never)).rejects.toThrow(HttpException);
  });

  it('never blocks on an unlimited plan (null monthlyInvestigationLimit) no matter how high usage is', async () => {
    const quota = new QuotaService({} as PrismaService);
    const db = makeFakeDb({
      alignmentLabEnabled: true,
      monthlyInvestigationLimit: null,
      investigationUsageCount: 999_999,
    });
    await expect(quota.assertCanRunInvestigation('u1', 'user', db as never)).resolves.toBeUndefined();
  });

  it('lets admin and super_admin through regardless of plan — support/testing bypass', async () => {
    const quota = new QuotaService({} as PrismaService);
    const db = makeFakeDb({ alignmentLabEnabled: false });
    await expect(quota.assertCanRunInvestigation('u1', 'admin', db as never)).resolves.toBeUndefined();
    await expect(quota.assertCanRunInvestigation('u1', 'super_admin', db as never)).resolves.toBeUndefined();
  });
});
