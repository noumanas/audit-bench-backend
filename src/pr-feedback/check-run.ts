import { PrFeedback } from './pr-feedback.types';

/**
 * The check's name in GitHub's checks list. Branch protection matches a
 * required check by this name, so it must never change once teams rely on it.
 */
export const CHECK_NAME = 'Audit Bench Ai';
/** GitHub accepts at most 50 annotations per check-run request. */
const MAX_ANNOTATIONS = 50;

export type CheckConclusion = 'success' | 'neutral' | 'failure';

/**
 * The review's verdict as a merge gate: a blocking (critical) issue fails
 * the check; issues worth a look are "neutral", which GitHub shows but which
 * still satisfies a required check; a clean review succeeds.
 */
export function checkConclusion(feedback: PrFeedback): CheckConclusion {
  // Blocking: a critical issue, or anything that makes the PR "not ready to merge"
  // (a high-severity security issue, an exposed secret, failing CI, conflicts).
  if (feedback.verdict === 'do_not_ship' || feedback.readiness?.status === 'not_ready') return 'failure';
  return feedback.verdict === 'needs_work' ? 'neutral' : 'success';
}

const LEVEL: Record<string, 'failure' | 'warning' | 'notice'> = {
  critical: 'failure',
  high: 'failure',
  medium: 'warning',
  low: 'notice',
};

/** The body for GitHub's create-check-run API: conclusion, summary, and one annotation per finding. */
export function buildCheckRun(feedback: PrFeedback, headSha: string) {
  const conclusion = checkConclusion(feedback);
  const counts = ['critical', 'high', 'medium', 'low']
    .map((s) => [s, feedback.findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n);
  const title =
    conclusion === 'failure'
      ? 'Blocking issues found'
      : conclusion === 'neutral'
        ? `${feedback.findings.length} issue${feedback.findings.length === 1 ? '' : 's'} worth a look`
        : 'No issues found';

  const summary = [
    conclusion === 'failure'
      ? [
          'Audit Bench Ai found something that should be fixed before merging:',
          ...(feedback.readiness?.blockers.length
            ? feedback.readiness.blockers.map((b) => `- ${b}`)
            : ['- A critical issue in the changed lines.']),
          '',
          'Fix it and push again, or reply on the review comment if it’s not an issue.',
        ].join('\n')
      : conclusion === 'neutral'
        ? 'Nothing blocking, but some findings are worth reviewing before merging.'
        : 'Audit Bench Ai found no issues in the changed lines.',
    '',
    `**Findings:** ${counts.length ? counts.map(([s, n]) => `${n} ${s}`).join(', ') : 'none'}`,
    ...(feedback.readiness ? [`**Merge readiness:** ${feedback.readiness.status.replace(/_/g, ' ')}`] : []),
    ...(feedback.scanUrl ? ['', `[Full report](${feedback.scanUrl})`] : []),
  ].join('\n');

  const annotations = feedback.findings
    .filter((f) => f.line !== null && f.line > 0)
    .slice(0, MAX_ANNOTATIONS)
    .map((f) => ({
      path: f.path,
      start_line: f.line as number,
      end_line: f.endLine && f.endLine > (f.line as number) ? f.endLine : (f.line as number),
      annotation_level: LEVEL[f.severity] ?? 'notice',
      title: f.title.slice(0, 255),
      message: [f.description, f.suggestedFix ? `Suggested fix: ${f.suggestedFix}` : '']
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 64_000),
    }));

  return {
    name: CHECK_NAME,
    head_sha: headSha,
    status: 'completed' as const,
    conclusion,
    ...(feedback.scanUrl ? { details_url: feedback.scanUrl } : {}),
    output: { title, summary, annotations },
  };
}

/** Posted the moment a review starts: GitHub shows it with a spinner until it's completed. */
export function inProgressCheckRun(headSha: string) {
  return {
    name: CHECK_NAME,
    head_sha: headSha,
    status: 'in_progress' as const,
    started_at: new Date().toISOString(),
    output: {
      title: 'Reviewing…',
      summary: 'Audit Bench Ai is reviewing the changes in this commit. This usually takes 1–2 minutes.',
    },
  };
}

/**
 * Closes a check whose review couldn't finish (an error, or the plan's
 * limit). Neutral, so it never blocks a merge or spins forever.
 */
export function stoppedCheckRun(reason: string) {
  return {
    status: 'completed' as const,
    conclusion: 'neutral' as const,
    completed_at: new Date().toISOString(),
    output: { title: 'Review didn’t finish', summary: reason },
  };
}
