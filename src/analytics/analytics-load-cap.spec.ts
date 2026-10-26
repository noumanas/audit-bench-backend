import { AnalyticsService } from './analytics.service';

describe('AnalyticsService loading', () => {
  it('reads at most the newest 1,000 audits and scans, never the whole window', async () => {
    const prisma = {
      audit: { findMany: jest.fn().mockResolvedValue([]) },
      scanJob: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new AnalyticsService(prisma as never);
    await (service as any).loadResourceScores({ id: 'u1', organizationId: null }, new Date('2026-05-01'));
    for (const call of [prisma.audit.findMany.mock.calls[0][0], prisma.scanJob.findMany.mock.calls[0][0]]) {
      expect(call.take).toBe(1000);
      expect(call.orderBy).toEqual({ createdAt: 'desc' });
    }
  });
});
