import { Verdict } from '@prisma/client';
import { Finding } from '../common/finding.schema';

export interface CommitFixResult {
  commitUrl: string;
  pullRequestUrl?: string;
  /** True when this commit opened a brand-new PR/MR (repo scan); false when it landed on an already-open one. */
  created: boolean;
}

export interface RecheckFixResult {
  before: { verdict: Verdict | null; findingsCount: number };
  after: { verdict: Verdict; findings: Finding[] };
  /** True once the file has 0 findings, or the new verdict is a clean pass. */
  resolved: boolean;
}
