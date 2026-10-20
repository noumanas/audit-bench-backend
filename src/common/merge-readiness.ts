import { Verdict } from '@prisma/client';

/** What GitHub reported about a pull request when it was reviewed. Persisted on ScanJob.prSnapshot. */
export interface PrSnapshot {
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  merged: boolean;
  draft: boolean;
  /** null while GitHub is still computing it. */
  mergeable: boolean | null;
  /** GitHub's mergeable_state: clean, dirty, blocked, behind, unstable, has_hooks, unknown, draft. */
  mergeableState: string;
  baseRef: string;
  headRef: string;
  headSha: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  checks: { passed: number; failed: string[]; pending: string[] };
  /** Changed files the review actually read, and how many it left out (cap, binary, unsupported language). */
  filesReviewed: number;
  filesSkipped: number;
  fetchedAt: string;
}

export type MergeReadinessStatus = 'ready' | 'ready_with_notes' | 'not_ready' | 'merged' | 'closed';

export interface MergeReadiness {
  status: MergeReadinessStatus;
  /** Must be fixed before merging. */
  blockers: string[];
  /** Worth a look, but not a reason to hold the merge on their own. */
  notes: string[];
}

export interface ReviewOutcome {
  verdict: Verdict | null;
  findings: { critical: number; high: number; medium: number; low: number };
  secrets: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Merge readiness from two sources: GitHub's own view of the PR (state,
 * conflicts, CI checks) and the local checks run on the changed lines. A
 * verdict, not a guarantee — the public page says so.
 */
export function assessMergeReadiness(pr: PrSnapshot, review: ReviewOutcome): MergeReadiness {
  if (pr.merged) return { status: 'merged', blockers: [], notes: [] };
  if (pr.state === 'closed') return { status: 'closed', blockers: [], notes: [] };

  const blockers: string[] = [];
  const notes: string[] = [];

  if (pr.draft) blockers.push('The pull request is still a draft.');
  if (pr.mergeable === false || pr.mergeableState === 'dirty') {
    blockers.push(`Merge conflicts with ${pr.baseRef} need resolving.`);
  }
  if (pr.checks.failed.length) {
    blockers.push(`${plural(pr.checks.failed.length, 'CI check')} failing: ${listNames(pr.checks.failed)}.`);
  }
  if (review.secrets > 0) {
    blockers.push(`${plural(review.secrets, 'potential secret')} added in the changed code.`);
  }
  const serious = review.findings.critical + review.findings.high;
  if (review.verdict === 'do_not_ship' || review.findings.critical > 0) {
    blockers.push(`${plural(serious, 'critical or high-severity issue')} in the changed lines.`);
  } else if (serious > 0) {
    notes.push(`${plural(serious, 'high-severity finding')} in the changed lines worth checking.`);
  }

  if (pr.checks.pending.length) {
    notes.push(`${plural(pr.checks.pending.length, 'CI check')} still running: ${listNames(pr.checks.pending)}.`);
  }
  if (pr.mergeableState === 'behind') notes.push(`The branch is behind ${pr.baseRef}; update it before merging.`);
  if (pr.mergeableState === 'blocked') notes.push('Branch protection still needs approvals or required checks.');
  if (pr.mergeableState === 'unstable' && !pr.checks.failed.length && !pr.checks.pending.length) {
    // Typically workflows on a fork's PR waiting for a maintainer to approve them.
    notes.push('GitHub reports checks that are failing or waiting for approval to run.');
  }
  if (pr.mergeable === null) notes.push('GitHub was still working out whether the branch merges cleanly.');
  const minor = review.findings.medium + review.findings.low;
  if (minor > 0) notes.push(`${plural(minor, 'medium or low-severity finding')} to review.`);
  if (pr.filesSkipped > 0) {
    notes.push(`${plural(pr.filesSkipped, 'changed file')} not reviewed (size cap, binary or unsupported language).`);
  }

  return { status: blockers.length ? 'not_ready' : notes.length ? 'ready_with_notes' : 'ready', blockers, notes };
}

function listNames(names: string[]): string {
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ');
}

/** Readiness for a stored, finished GitHub PR review; null for anything else. */
export function readinessForScan(job: {
  sourceType: string;
  status: string;
  verdict: Verdict | null;
  prSnapshot: unknown;
  secrets: unknown;
  files: Array<{ findings: unknown }>;
}): MergeReadiness | null {
  if (job.sourceType !== 'github_pr' || job.status !== 'completed' || !job.prSnapshot) return null;
  const findings = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of job.files) {
    for (const x of (Array.isArray(f.findings) ? f.findings : []) as Array<{ severity?: string }>) {
      if (x.severity && x.severity in findings) findings[x.severity as keyof typeof findings]++;
    }
  }
  return assessMergeReadiness(job.prSnapshot as PrSnapshot, {
    verdict: job.verdict,
    findings,
    secrets: Array.isArray(job.secrets) ? job.secrets.length : 0,
  });
}
