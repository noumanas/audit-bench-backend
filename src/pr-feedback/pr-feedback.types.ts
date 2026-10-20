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
    }
  | {
      kind: 'gitlab';
      projectId: number;
      mrIid: number;
      headSha: string;
      diffRefs: { baseSha: string; startSha: string; headSha: string };
      sourceBranch: string;
      targetBranch: string;
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
}

export interface PrPublisher {
  publish(userId: string, context: Extract<PrContext, { kind: string }>, feedback: PrFeedback): Promise<void>;
}

/** Signs every review summary, so readers of the PR know where it came from. */
export const REVIEW_FOOTER =
  '<sub>Reviewed by [Audit Bench Ai](https://auditbenchai.com/?utm_source=pr_review&utm_medium=comment) · AI code review for security, logic and performance · [Review any public PR free](https://auditbenchai.com/scan?utm_source=pr_review&utm_medium=comment)</sub>';
