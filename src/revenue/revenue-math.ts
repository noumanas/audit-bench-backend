/**
 * Pure MRR arithmetic over subscription terms — no database, so it's easy to
 * test and reason about. A term earns its monthly amount for every instant in
 * [startedAt, endedAt ?? endsAt).
 */

export interface Term {
  accountKey: string;
  amountCents: number;
  startedAt: Date;
  endsAt: Date;
  endedAt: Date | null;
}

export interface MonthMovement {
  /** First day of the month, YYYY-MM. */
  month: string;
  /** MRR at the end of the month (or now, for the current month). */
  mrrCents: number;
  newCents: number;
  reactivationCents: number;
  expansionCents: number;
  contractionCents: number;
  churnCents: number;
  /** Accounts paying at the end of the month. */
  accounts: number;
}

const effectiveEnd = (t: Term) => (t.endedAt && t.endedAt < t.endsAt ? t.endedAt : t.endsAt);

/** MRR by account at one instant. */
export function mrrByAccount(terms: Term[], at: Date): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of terms) {
    if (t.startedAt <= at && at < effectiveEnd(t)) out.set(t.accountKey, (out.get(t.accountKey) ?? 0) + t.amountCents);
  }
  return out;
}

export function totalMrr(terms: Term[], at: Date): number {
  let sum = 0;
  for (const v of mrrByAccount(terms, at).values()) sum += v;
  return sum;
}

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

/**
 * Month-by-month MRR and its movements: new, reactivation (an account that
 * paid before, lapsed, and came back), expansion, contraction and churn,
 * comparing each account's MRR at the start and end of the month.
 */
export function monthlyMovements(terms: Term[], months: number, now = new Date()): MonthMovement[] {
  const firstStart = new Map<string, Date>();
  for (const t of terms) {
    const prev = firstStart.get(t.accountKey);
    if (!prev || t.startedAt < prev) firstStart.set(t.accountKey, t.startedAt);
  }

  const out: MonthMovement[] = [];
  const current = monthStart(now);
  for (let i = months - 1; i >= 0; i--) {
    const start = addMonths(current, -i);
    const nextStart = addMonths(start, 1);
    // "End" is just before next month starts, or now for the running month.
    const end = nextStart > now ? now : new Date(nextStart.getTime() - 1);
    const before = mrrByAccount(terms, new Date(start.getTime() - 1));
    const after = mrrByAccount(terms, end);
    const m: MonthMovement = {
      month: start.toISOString().slice(0, 7),
      mrrCents: 0,
      newCents: 0,
      reactivationCents: 0,
      expansionCents: 0,
      contractionCents: 0,
      churnCents: 0,
      accounts: 0,
    };
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      const a = before.get(key) ?? 0;
      const b = after.get(key) ?? 0;
      if (a === 0 && b > 0) {
        if ((firstStart.get(key) ?? start) < start) m.reactivationCents += b;
        else m.newCents += b;
      } else if (a > 0 && b === 0) m.churnCents += a;
      else if (b > a) m.expansionCents += b - a;
      else if (b < a) m.contractionCents += a - b;
    }
    for (const v of after.values()) {
      m.mrrCents += v;
      if (v > 0) m.accounts++;
    }
    out.push(m);
  }
  return out;
}
