import { isPlanExpired, planExpiryFor } from './plan-expiry';

describe('planExpiryFor', () => {
  it('gives paid plans 30 days and Free none', () => {
    const from = new Date('2026-10-05T00:00:00Z');
    expect(planExpiryFor({ slug: 'pro' }, from)?.toISOString()).toBe('2026-11-04T00:00:00.000Z');
    expect(planExpiryFor({ slug: 'enterprise' }, from)?.toISOString()).toBe('2026-11-04T00:00:00.000Z');
    expect(planExpiryFor({ slug: 'free' }, from)).toBeNull();
  });

  it('treats a past expiry as expired and null as never', () => {
    const now = new Date('2026-10-05T00:00:00Z');
    expect(isPlanExpired(new Date('2026-10-04T23:59:59Z'), now)).toBe(true);
    expect(isPlanExpired(new Date('2026-10-05T00:00:01Z'), now)).toBe(false);
    expect(isPlanExpired(null, now)).toBe(false);
  });
});
