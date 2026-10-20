import { LineRange } from '../common/diff-ranges';
import { ANALYZABLE_EXTENSIONS } from '../common/language';
import { PrFeedbackFinding } from './pr-feedback.types';

const SEVERITY: Record<string, string> = {
  critical: '🔴 Critical',
  high: '🟠 High',
  medium: '🟡 Medium',
  low: '🔵 Low',
};

const CATEGORY: Record<string, string> = {
  Security: '🛡️ Security',
  Logic: '🧠 Logic',
  Performance: '⚡ Performance',
  Architecture: '🏗️ Architecture',
  Maintainability: '🧹 Maintainability',
  Testing: '🧪 Testing',
};

/**
 * Hidden markers. FINDING marks a thread Audit Bench Ai started, so a reply
 * in it is meant for the agent; REPLY marks the agent's own answers, so it
 * never answers itself — both are needed because comments post as the
 * user's own GitHub account, not a separate bot login.
 */
export const FINDING_MARKER = '<!-- audit-bench:finding -->';
export const REPLY_MARKER = '<!-- audit-bench:reply -->';

/** Longest range one comment covers; past this a finding points at its first line only. */
const MAX_RANGE_LINES = 40;

/**
 * Where an inline comment goes: its first and last line in the new file.
 * GitHub and GitLab only accept lines inside the diff, and a multi-line
 * comment must stay within one hunk, so the range is clipped to the hunk
 * holding the first line. Null when the finding has no line or it falls
 * outside every changed range.
 */
export function commentLines(f: PrFeedbackFinding, ranges?: LineRange[]): { start: number; end: number } | null {
  if (f.line === null || f.line < 1) return null;
  const hunk = ranges?.length ? ranges.find((r) => f.line! >= r.start && f.line! <= r.end) : undefined;
  if (ranges?.length && !hunk) return null;
  let end = f.endLine && f.endLine > f.line ? f.endLine : f.line;
  if (hunk) end = Math.min(end, hunk.end);
  if (end - f.line + 1 > MAX_RANGE_LINES) end = f.line;
  return { start: f.line, end };
}

/**
 * One finding as a review comment, CodeRabbit-style: a category and
 * severity line, the issue as a bold headline, what's wrong, why, how to fix
 * it (with the example patch as a highlighted code block), and a footer
 * inviting a reply — replies are answered in the thread (see WebhooksService).
 */
export function inlineCommentBody(f: PrFeedbackFinding): string {
  const header = [f.category ? (CATEGORY[f.category] ?? f.category) : null, SEVERITY[f.severity] ?? f.severity]
    .filter(Boolean)
    .join(' | ');
  const lines = [FINDING_MARKER, `**${header}**`, '', `**${f.title}**`, '', f.description];
  if (f.rootCause) lines.push('', `**Why it happens:** ${f.rootCause}`);
  if (f.suggestedFix) lines.push('', `**Suggested fix:** ${f.suggestedFix}`);
  if (f.examplePatch?.trim()) {
    // A longer fence than any run of backticks inside the patch keeps it from closing early.
    const longest = Math.max(2, ...(f.examplePatch.match(/`+/g) ?? []).map((m) => m.length));
    const fence = '`'.repeat(longest + 1);
    // GitHub and GitLab both take a file extension as the highlighting language.
    const ext = f.path.split('.').pop()?.toLowerCase() ?? '';
    lines.push('', `${fence}${ANALYZABLE_EXTENSIONS.has(ext) ? ext : ''}`, f.examplePatch.trimEnd(), fence);
  }
  const meta = [
    typeof f.confidence === 'number' ? `${Math.round(f.confidence * 100)}% confidence` : null,
    '💬 Reply here and Audit Bench Ai will recheck the code',
  ].filter(Boolean);
  lines.push('', `<sub>${meta.join(' · ')}</sub>`);
  return lines.join('\n');
}
