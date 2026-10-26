import { MergeReadiness } from '../common/merge-readiness';
import { PrFeedback, REVIEW_FOOTER, automatedReviewNotice } from './pr-feedback.types';
import { PreMergeCheck } from './pr-insights';

/** Hidden marker on the summary, so Audit Bench Ai can tell its own summaries apart. */
export const SUMMARY_MARKER = '<!-- audit-bench:summary -->';

const OPEN_BADGE =
  'https://img.shields.io/badge/Audit%20Bench%20Ai-Open%20full%20report%20%E2%86%97-2b5be3?style=for-the-badge';

const VERDICT_LABEL = { pass: '✅ Pass', needs_work: '⚠️ Needs work', do_not_ship: '⛔ Do not ship' } as const;

const READINESS_LABEL: Record<MergeReadiness['status'], string> = {
  ready: '✅ Ready to merge',
  ready_with_notes: '🟡 Ready to merge, with notes',
  not_ready: '⛔ Not ready to merge',
  merged: '🟣 Already merged',
  closed: '⚪ Closed without merging',
};

const RISK_LABEL = { minimal: '⚪ Minimal', low: '🟢 Low', medium: '🟡 Medium', high: '🔴 High' } as const;
const CHECK_ICON: Record<PreMergeCheck['status'], string> = { pass: '✅', warning: '⚠️', fail: '❌' };

/** The files a check applies to, on their own lines inside its table cell. */
const fileCell = (files: string[] | undefined) =>
  files?.length ? files.map((f) => `<br>📄 \`${cell(f).replace(/`/g, '')}\``).join('') : '';

/** Table cells can't hold pipes or line breaks. */
const cell = (s: string | null | undefined) =>
  (s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
    .trim();

const details = (summary: string, body: string[], open = false) => [
  open ? '<details open>' : '<details>',
  `<summary>${summary}</summary>`,
  '',
  ...body,
  '',
  '</details>',
];

/**
 * The review's top-level comment, CodeRabbit-style: a button to the full
 * report, the count of inline comments, merge risk, a pre-merge checks
 * table (GitHub state, findings, and the AI's title / description / linked
 * issue / scope checks), a walkthrough, review details, a prompt an AI
 * coding agent can paste to fix everything, and how to talk back.
 */
export function buildSummaryBody(feedback: PrFeedback, opts: { posted?: number; headSha?: string } = {}): string {
  const sha = (opts.headSha ?? feedback.headSha)?.slice(0, 7);
  const insights = feedback.insights;
  const lines: string[] = [SUMMARY_MARKER];

  if (feedback.scanUrl) lines.push(`[![Open in Audit Bench Ai](${OPEN_BADGE})](${feedback.scanUrl})`, '');
  if (feedback.viaUserAccount) lines.push(automatedReviewNotice(feedback.viaUserAccount), '');
  if (feedback.requestedBy) lines.push(`_Review requested by @${feedback.requestedBy}._`, '');

  if (opts.posted === undefined) lines.push(`### Audit Bench Ai review: ${VERDICT_LABEL[feedback.verdict]}`);
  else if (opts.posted > 0) lines.push(`**Actionable comments posted: ${opts.posted}**`);
  else if (feedback.findings.length === 0) lines.push('No actionable comments were generated in this review. 🎉');
  else
    lines.push(
      `**Findings: ${feedback.findings.length}**, listed in the fix prompt below (they couldn't be placed as inline comments).`,
    );
  lines.push('');

  // Merge risk (AI) and readiness (GitHub state + findings).
  if (insights) {
    lines.push(
      ...details(
        `<b>Merge risk:</b> ${RISK_LABEL[insights.mergeRisk.level]}${sha ? ` · up to <code>${sha}</code>` : ''}`,
        [insights.mergeRisk.explanation],
        true,
      ),
      '',
    );
  }
  if (feedback.readiness) {
    lines.push(`**Merge readiness:** ${READINESS_LABEL[feedback.readiness.status]}`, '');
    // Without a checks table, list what's behind the verdict.
    if (!feedback.checks?.length) {
      if (feedback.readiness.blockers.length) {
        lines.push('_Fix before merging:_', ...feedback.readiness.blockers.map((b) => `- ${b}`), '');
      }
      if (feedback.readiness.notes.length) {
        lines.push('_Worth a look:_', ...feedback.readiness.notes.map((n) => `- ${n}`), '');
      }
    }
  }

  const checks: PreMergeCheck[] = [
    ...(feedback.checks ?? []),
    ...(insights?.checks ?? []).map((c) => ({ ...c, resolution: c.resolution ?? undefined })),
  ];
  if (checks.length) {
    const failed = checks.filter((c) => c.status !== 'pass');
    const passed = checks.filter((c) => c.status === 'pass');
    const errors = failed.filter((c) => c.status === 'fail').length;
    const warnings = failed.length - errors;
    const counts = [
      errors && `${errors} error${errors === 1 ? '' : 's'}`,
      warnings && `${warnings} warning${warnings === 1 ? '' : 's'}`,
    ].filter(Boolean);
    const body: string[] = [];
    if (failed.length) {
      body.push(
        errors ? `❌ **Failed checks: ${counts.join(', ')}**` : `⚠️ **Checks to review: ${counts.join(', ')}**`,
        '',
        '| Check name | Status | Explanation | Resolution |',
        '| --- | :---: | --- | --- |',
        ...failed.map(
          (c) =>
            `| ${cell(c.name)} | ${CHECK_ICON[c.status]} | ${cell(c.explanation)}${fileCell(c.files)} | ${cell(c.resolution) || '-'} |`,
        ),
        '',
      );
    }
    if (passed.length) {
      body.push(
        ...details(
          `✅ Passed checks: ${passed.length} passed`,
          [
            '| Check name | Status | Explanation |',
            '| --- | :---: | --- |',
            ...passed.map((c) => `| ${cell(c.name)} | ✅ | ${cell(c.explanation)} |`),
          ],
          !failed.length,
        ),
      );
    }
    const tally = [`✅ ${passed.length}`, warnings && `⚠️ ${warnings}`, errors && `❌ ${errors}`].filter(Boolean);
    lines.push(...details(`<b>Pre-merge checks:</b> ${tally.join(' · ')}`, body, true), '');
  }

  if (insights) {
    lines.push(
      ...details('📝 Walkthrough', [
        insights.walkthrough,
        ...(insights.files.length
          ? [
              '',
              '| File | Changes |',
              '| --- | --- |',
              ...insights.files.map((f) => `| \`${cell(f.path)}\` | ${cell(f.summary)} |`),
            ]
          : []),
      ]),
      '',
    );
  }

  const counts = ['critical', 'high', 'medium', 'low']
    .map((s) => [s, feedback.findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n);
  lines.push(
    ...details('ℹ️ Review info', [
      ...(sha ? [`- **Commit:** \`${sha}\``] : []),
      `- **Verdict:** ${VERDICT_LABEL[feedback.verdict]}`,
      `- **Findings:** ${counts.length ? counts.map(([s, n]) => `${n} ${s}`).join(', ') : 'none'}`,
      `- **Review:** ${feedback.local ? 'automated local checks only (free review, no AI)' : 'local checks plus AI review of the changed lines'}`,
      ...(feedback.summary ? [`- **Scope:** ${feedback.summary}`] : []),
    ]),
    '',
  );

  if (feedback.findings.length) {
    lines.push(
      ...details('🤖 Prompt to fix review comments', [
        '````text',
        'Verify each finding against the current code and only fix it if it still applies.',
        '',
        ...feedback.findings
          .slice(0, 50)
          .flatMap((f) => [
            `In \`@${f.path}\`${f.line ? ` around ${f.endLine && f.endLine > f.line ? `lines ${f.line} - ${f.endLine}` : `line ${f.line}`}` : ''}: ${f.title}. ${f.description}${f.suggestedFix ? ` Suggested fix: ${f.suggestedFix}` : ''}`,
            '',
          ]),
        '````',
      ]),
      '',
    );
  }

  lines.push(
    '💬 Reply to any inline comment and Audit Bench Ai will recheck that code and answer in the thread. Mention `@auditbench` in the conversation to ask about the whole PR.',
  );
  if (feedback.scanUrl) lines.push('', `🛠️ [Open the full report and fix with AI](${feedback.scanUrl})`);
  lines.push(
    '',
    'Thanks for using [Audit Bench Ai](https://auditbenchai.com/?utm_source=pr_review&utm_medium=comment)! Free pull request reviews for open source: paste any public PR at [auditbenchai.com/scan](https://auditbenchai.com/scan?utm_source=pr_review&utm_medium=comment).',
    '',
    REVIEW_FOOTER,
  );
  return lines.join('\n');
}

/**
 * The summary for hosts whose Markdown shows HTML as text (Bitbucket): the
 * same content as buildSummaryBody, without collapsible sections or tables.
 */
export function buildPlainSummary(feedback: PrFeedback, opts: { posted?: number; headSha?: string } = {}): string {
  const sha = (opts.headSha ?? feedback.headSha)?.slice(0, 7);
  const counts = ['critical', 'high', 'medium', 'low']
    .map((s) => [s, feedback.findings.filter((f) => f.severity === s).length] as const)
    .filter(([, n]) => n);
  const lines = [`### Audit Bench Ai review: ${VERDICT_LABEL[feedback.verdict]}`, ''];
  if (feedback.viaUserAccount) lines.push(automatedReviewNotice(feedback.viaUserAccount).replace(/^> /, ''), '');
  if (opts.posted !== undefined) {
    lines.push(
      opts.posted > 0
        ? `**Actionable comments posted: ${opts.posted}**`
        : feedback.findings.length
          ? `**Findings: ${feedback.findings.length}**, listed below.`
          : 'No actionable comments were generated in this review. 🎉',
      '',
    );
  }
  if (feedback.readiness) lines.push(`**Merge readiness:** ${READINESS_LABEL[feedback.readiness.status]}`, '');
  lines.push(`**Findings:** ${counts.length ? counts.map(([s, n]) => `${n} ${s}`).join(', ') : 'none'}`, '');
  if (feedback.summary) lines.push(`**Scope:** ${feedback.summary}${sha ? ` (commit \`${sha}\`)` : ''}`, '');
  if (feedback.findings.length) {
    lines.push(
      '**Prompt to fix review comments** (paste into your AI coding agent):',
      '',
      '```text',
      'Verify each finding against the current code and only fix it if it still applies.',
      '',
      ...feedback.findings
        .slice(0, 50)
        .flatMap((f) => [
          `In \`@${f.path}\`${f.line ? ` around ${f.endLine && f.endLine > f.line ? `lines ${f.line} - ${f.endLine}` : `line ${f.line}`}` : ''}: ${f.title}. ${f.description}${f.suggestedFix ? ` Suggested fix: ${f.suggestedFix}` : ''}`,
          '',
        ]),
      '```',
      '',
    );
  }
  if (feedback.scanUrl) lines.push(`[Open the full report and fix with AI](${feedback.scanUrl})`, '');
  lines.push(
    '_Reviewed by [Audit Bench Ai](https://auditbenchai.com/?utm_source=pr_review&utm_medium=comment). Free pull request reviews for open source at [auditbenchai.com/scan](https://auditbenchai.com/scan?utm_source=pr_review&utm_medium=comment)._',
  );
  return lines.join('\n');
}
