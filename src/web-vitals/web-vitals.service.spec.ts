import { WebVitalsService } from './web-vitals.service';
import { PrismaService } from '../prisma/prisma.service';

function makeFakePrisma(rows: { name: string; value: number; rating: string }[]) {
  return {
    webVital: {
      create: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockResolvedValue(rows),
    },
  };
}

describe('WebVitalsService.record', () => {
  it('converts the hyphenated rating to the Prisma enum form', async () => {
    const prisma = makeFakePrisma([]);
    const service = new WebVitalsService(prisma as unknown as PrismaService);

    await service.record({ id: 'v1', name: 'LCP', value: 1800, rating: 'needs-improvement', path: '/pricing' });

    expect(prisma.webVital.create).toHaveBeenCalledWith({
      data: { metricId: 'v1', name: 'LCP', value: 1800, rating: 'needs_improvement', path: '/pricing' },
    });
  });
});

/**
 * Core Web Vitals is scored against p75 specifically, not a plain average —
 * get this wrong and the summary quietly stops meaning what everyone
 * (including Google's own CWV thresholds) expects "p75 LCP" to mean.
 */
describe('WebVitalsService.getSummary', () => {
  it('computes the 75th percentile per metric, not an average', async () => {
    // Values 100..1000 in steps of 100 (10 values) — p75 (nearest-rank) is the 8th value: 800.
    const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const rows = values.map((value) => ({ name: 'LCP', value, rating: 'good' }));
    const prisma = makeFakePrisma(rows);
    const service = new WebVitalsService(prisma as unknown as PrismaService);

    const summary = await service.getSummary();

    expect(summary).toHaveLength(1);
    expect(summary[0].name).toBe('LCP');
    expect(summary[0].count).toBe(10);
    expect(summary[0].p75).toBe(800);
  });

  it('splits the good/needs-improvement/poor percentages correctly', async () => {
    const rows = [
      { name: 'CLS', value: 0.05, rating: 'good' },
      { name: 'CLS', value: 0.05, rating: 'good' },
      { name: 'CLS', value: 0.15, rating: 'needs_improvement' },
      { name: 'CLS', value: 0.3, rating: 'poor' },
    ];
    const prisma = makeFakePrisma(rows);
    const service = new WebVitalsService(prisma as unknown as PrismaService);

    const [summary] = await service.getSummary();

    expect(summary.goodPct).toBe(50);
    expect(summary.needsImprovementPct).toBe(25);
    expect(summary.poorPct).toBe(25);
  });

  it('groups independently per metric name', async () => {
    const prisma = makeFakePrisma([
      { name: 'LCP', value: 1000, rating: 'good' },
      { name: 'CLS', value: 0.05, rating: 'good' },
    ]);
    const service = new WebVitalsService(prisma as unknown as PrismaService);

    const summary = await service.getSummary();

    expect(summary.map((s) => s.name)).toEqual(['CLS', 'LCP']);
  });

  it('returns an empty list when there is no data in the window', async () => {
    const prisma = makeFakePrisma([]);
    const service = new WebVitalsService(prisma as unknown as PrismaService);

    expect(await service.getSummary()).toEqual([]);
  });
});
