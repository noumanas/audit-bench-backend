/** Paid plans run this many days from approval, then fall back to Free. */
export const PLAN_TERM_DAYS = 30;

/** Expiry to stamp when an account moves onto `plan` — null for Free, which never expires. */
export function planExpiryFor(plan: { slug: string }, from = new Date()): Date | null {
  if (plan.slug === 'free') return null;
  return new Date(from.getTime() + PLAN_TERM_DAYS * 24 * 60 * 60 * 1000);
}

export function isPlanExpired(expiresAt: Date | null | undefined, now = new Date()): boolean {
  return expiresAt != null && expiresAt.getTime() <= now.getTime();
}
