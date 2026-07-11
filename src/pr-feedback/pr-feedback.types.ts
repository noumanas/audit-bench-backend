import { Verdict } from '@prisma/client';

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
  severity: string;
  title: string;
  description: string;
}

export interface PrFeedback {
  verdict: Verdict;
  summary: string;
  findings: PrFeedbackFinding[];
  scanUrl?: string;
}

export interface PrPublisher {
  publish(userId: string, context: Extract<PrContext, { kind: string }>, feedback: PrFeedback): Promise<void>;
}
