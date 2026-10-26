import { Verdict } from '@prisma/client';
import { MergeReadiness } from '../common/merge-readiness';
import { LineRange } from '../common/diff-ranges';
import type { PrInsights, PreMergeCheck } from './pr-insights';

export type PrContext =
  | {
      kind: 'github';
      owner: string;
      repo: string;
      pullNumber: number;
      headSha: string;
      // Branch names — needed by FixService to commit a fix straight onto
      // the open PR's branch (posting review feedback only needs the sha).
      headRef: string;
      baseRef: string;
      /** Set when the GitHub App started this review: it posts as the app's bot. */
      installationId?: number;
      /** The "Reviewing…" check posted when the review started; completed with the verdict. */
      checkRunId?: number;
    }
  | {
      kind: 'gitlab';
      projectId: number;
      mrIid: number;
      headSha: string;
      diffRefs: { baseSha: string; startSha: string; headSha: string };
      sourceBranch: string;
      targetBranch: string;
    }
  | {
      kind: 'bitbucket';
      workspace: string;
      repoSlug: string;
      pullId: number;
      /** Full commit hash of the PR's source branch head. */
      headSha: string;
      sourceBranch: string;
      destinationBranch: string;
    };

export interface PrFeedbackFinding {
  path: string;
  line: number | null;
  endLine?: number | null;
  severity: string;
  title: string;
  description: string;
  category?: string;
  rootCause?: string;
  suggestedFix?: string;
  examplePatch?: string | null;
  /** Exact new code for lines line..endLine — posted as a one-click GitHub suggestion. */
  replacement?: string | null;
  confidence?: number;
}

export interface PrFeedback {
  verdict: Verdict;
  summary: string;
  findings: PrFeedbackFinding[];
  scanUrl?: string;
  /** Each reviewed file's changed line ranges — an inline comment must land inside one. */
  changedRanges?: Record<string, LineRange[]>;
  /** Shown in the summary when Audit Bench Ai's own account posts on someone's request. */
  requestedBy?: string;
  /** The reviewed commit, for "Merge risk … up to abc1234". */
  headSha?: string;
  /** AI walkthrough, merge risk and title/description/scope checks — absent for local-only reviews. */
  insights?: PrInsights;
  /** GitHub-state and findings checks (conflicts, CI, secrets, tests, size). */
  checks?: PreMergeCheck[];
  /** True for a free review made with local checks only (no AI). */
  local?: boolean;
  /** GitHub PR reviews with a snapshot — conflicts, CI and blockers, rendered at the top of the summary. */
  readiness?: MergeReadiness;
  /**
   * Set by the publisher when the review posts through a person's own token
   * rather than the Audit Bench Ai GitHub App's bot, so every comment says it
   * is automated and not that person's own review.
   */
  viaUserAccount?: { host: 'github' | 'gitlab' | 'bitbucket' };
}

/** Where users install the GitHub App so reviews post as its bot instead of their account. */
export const GITHUB_APP_SETUP_URL = 'https://auditbenchai.com/app/repository?source=github&utm_source=pr_review';

/** The line under a review's heading when it was posted through someone's own account. */
export function automatedReviewNotice(via: NonNullable<PrFeedback['viaUserAccount']>): string {
  return via.host === 'github'
    ? `> 🤖 **Automated review by Audit Bench Ai**, not a personal review. It was posted through the GitHub account connected to Audit Bench Ai. [Install the Audit Bench Ai GitHub App](${GITHUB_APP_SETUP_URL}) to have reviews posted by a separate bot account.`
    : '> 🤖 **Automated review by Audit Bench Ai**, not a personal review. It was posted through the account connected to Audit Bench Ai.';
}

export interface PrPublisher {
  publish(userId: string, context: Extract<PrContext, { kind: string }>, feedback: PrFeedback): Promise<void>;
  /** Clears any "reviewing…" status when a review couldn't finish. */
  fail?(userId: string, context: Extract<PrContext, { kind: string }>, reason: string): Promise<void>;
}

/** Signs every review summary, so readers of the PR know where it came from. */
export const REVIEW_FOOTER =
  '<sub>Reviewed by [Audit Bench Ai](https://auditbenchai.com/?utm_source=pr_review&utm_medium=comment) · AI code review for security, logic and performance · [Review any public PR free](https://auditbenchai.com/scan?utm_source=pr_review&utm_medium=comment)</sub>';
