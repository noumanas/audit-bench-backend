import { Term, monthlyMovements, totalMrr } from './revenue-math';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const term = (accountKey: string, amount: number, start: string, end: string, endedAt?: string): Term => ({
  accountKey,
  amountCents: amount,
  startedAt: d(start),
  endsAt: d(end),
  endedAt: endedAt ? d(endedAt) : null,
});

describe('totalMrr', () => {
  it('counts terms running at that instant, honouring early endings', () => {
    const terms = [term('a', 2900, '2026-09-01', '2026-10-01'), term('b', 9900, '2026-09-10', '2026-10-10', '2026-09-20')];
    expect(totalMrr(terms, d('2026-09-15'))).toBe(12800);
    expect(totalMrr(terms, d('2026-09-25'))).toBe(2900); // b ended early
    expect(totalMrr(terms, d('2026-10-01'))).toBe(0); // end is exclusive
  });

  it('back-to-back renewal terms are continuous', () => {
    const terms = [term('a', 2900, '2026-09-01', '2026-10-01'), term('a', 2900, '2026-10-01', '2026-10-31')];
    expect(totalMrr(terms, d('2026-10-01'))).toBe(2900);
  });
});

describe('monthlyMovements', () => {
  const now = d('2026-10-15');

  it('classifies new, expansion, contraction and churn by month', () => {
    const terms = [
      // a: new in Sep at Pro, upgrades to Team on Oct 5 → expansion in Oct
      term('a', 2900, '2026-09-03', '2026-10-03'),
      term('a', 2900, '2026-10-03', '2026-11-02', '2026-10-05'),
      term('a', 9900, '2026-10-05', '2026-11-04'),
      // b: paying since Aug, not renewed after Sep 20 → churn in Sep
      term('b', 9900, '2026-08-21', '2026-09-20'),
      // c: Team in Sep, downgraded to Pro in Oct → contraction
      term('c', 9900, '2026-09-01', '2026-10-01'),
      term('c', 2900, '2026-10-01', '2026-10-31'),
    ];
    const [aug, sep, oct] = monthlyMovements(terms, 3, now);
    expect(aug).toMatchObject({ month: '2026-08', newCents: 9900, mrrCents: 9900 });
    expect(sep).toMatchObject({ month: '2026-09', newCents: 2900 + 9900, churnCents: 9900, accounts: 2 });
    expect(oct).toMatchObject({ month: '2026-10', expansionCents: 7000, contractionCents: 7000, mrrCents: 9900 + 2900 });
  });

  it('marks a returning account as reactivation, not new', () => {
    const terms = [term('a', 2900, '2026-07-01', '2026-07-31'), term('a', 2900, '2026-09-10', '2026-10-10')];
    const sep = monthlyMovements(terms, 3, now).find((m) => m.month === '2026-09')!;
    expect(sep.reactivationCents).toBe(2900);
    expect(sep.newCents).toBe(0);
  });
});
