/** Feedback counts by where they came from and what they said (FindingFeedback.source / .signal). */
export type SignalCounts = Partial<Record<string, Partial<Record<string, number>>>>;

export interface ReviewVolume {
  /** Completed pull/merge request reviews in the window. */
  reviews: number;
  /** Findings those reviews produced (published or not). */
  findings: number;
  inputTokens: number;
  outputTokens: number;
  /** Summed prRepeatStats: findings posted, and held back as already open or dismissed. */
  repeats?: { posted: number; open: number; dismissed: number };
}

const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null);

/**
 * How useful reviews are, rather than how many findings they produce:
 * - precision: of findings the team reacted to by the time a PR closed, the
 *   share accepted (fixed, resolved or 👍) rather than dismissed (👎);
 * - acceptance / dismissal / ignored: the same outcomes over all findings;
 * - discussion: after a contributor disputed a finding, how often the
 *   recheck withdrew it, kept it, lowered its severity, or saw it fixed —
 *   "downgraded" is the measure of overstated severity;
 * - acknowledged: share of findings a person reacted 👀 to or replied on;
 * - duplicates: of findings a review raised that were already on the PR,
 *   the share held back instead of posted again;
 * - cost: tokens per review and per finding.
 * A rate is null when there's nothing yet to measure it on.
 */
export function reviewQuality(signals: SignalCounts, volume: ReviewVolume) {
  const outcome = signals.outcome ?? {};
  const accepted = outcome.accepted ?? 0;
  const dismissed = outcome.dismissed ?? 0;
  const ignored = outcome.ignored ?? 0;
  const closed = accepted + dismissed + ignored;

  const thread = signals.thread ?? {};
  const discussion = {
    resolved: thread.resolved ?? 0,
    withdrawn: thread.not_an_issue ?? 0,
    upheld: thread.confirmed ?? 0,
    downgraded: thread.downgraded ?? 0,
  };
  const disputed = discussion.withdrawn + discussion.upheld + discussion.downgraded;

  const tokens = volume.inputTokens + volume.outputTokens;
  const acknowledged = signals.reaction?.acknowledged ?? 0;
  const rep = volume.repeats ?? { posted: 0, open: 0, dismissed: 0 };
  const heldBack = rep.open + rep.dismissed;
  return {
    precision: rate(accepted, accepted + dismissed),
    acceptanceRate: rate(accepted, closed),
    dismissalRate: rate(dismissed, closed),
    ignoredRate: rate(ignored, closed),
    findingsWithOutcome: closed,
    acknowledged,
    acknowledgedRate: rate(acknowledged, closed),
    duplicates: {
      ...rep,
      /** Share of raised findings that were repeats of ones already on the PR (and so not posted). */
      duplicateRate: rate(heldBack, rep.posted + heldBack),
    },
    discussion: {
      ...discussion,
      /** Share of disputed findings the recheck withdrew: high means first reviews overreach. */
      withdrawnRate: rate(discussion.withdrawn, disputed),
      /** Share of disputed findings found valid but overstated. */
      severityOverstatedRate: rate(discussion.downgraded, disputed),
    },
    volume: {
      reviews: volume.reviews,
      findings: volume.findings,
      inputTokens: volume.inputTokens,
      outputTokens: volume.outputTokens,
      findingsPerReview: volume.reviews ? Math.round((volume.findings / volume.reviews) * 10) / 10 : null,
      tokensPerReview: volume.reviews ? Math.round(tokens / volume.reviews) : null,
      tokensPerFinding: volume.findings ? Math.round(tokens / volume.findings) : null,
    },
  };
}
