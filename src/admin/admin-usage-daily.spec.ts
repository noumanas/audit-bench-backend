import { AdminUsageService } from './admin-usage.service';

describe('AdminUsageService.userDetail daily series', () => {
  const realTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = realTz;
    jest.useRealTimers();
  });

  it('labels each day with the date its records fall on, even on a server ahead of UTC', async () => {
    process.env.TZ = 'Asia/Karachi'; // UTC+5: local midnight is the previous UTC day
    jest.useFakeTimers({ now: new Date('2026-10-26T12:00:00Z') });
    const record = (iso: string) => ({
      createdAt: new Date(iso),
      aiInvoked: true,
      fromCache: false,
      inputTokens: 10,
      outputTokens: 5,
    });
    const totals = { _count: { _all: 0 }, _sum: { inputTokens: 0, outputTokens: 0 } };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'u1' }) },
      audit: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([record('2026-10-26T01:00:00Z'), record('2026-10-25T23:30:00Z')])
          .mockResolvedValueOnce([]),
        aggregate: jest.fn().mockResolvedValue(totals),
      },
      scanJob: { findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue(totals) },
      planRequest: { findMany: jest.fn().mockResolvedValue([]) },
      activityLog: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new AdminUsageService(
      prisma as never,
      { getUsage: jest.fn().mockResolvedValue({}) } as never,
      {} as never,
    );

    const { daily } = await service.userDetail('u1');

    expect(daily).toHaveLength(30);
    expect(daily[29]).toMatchObject({ date: '2026-10-26', audits: 1, aiRuns: 1, tokens: 15 });
    expect(daily[28]).toMatchObject({ date: '2026-10-25', audits: 1 });
    expect(daily[0].date).toBe('2026-09-27');
  });
});
