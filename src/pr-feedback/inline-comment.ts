import { LineRange } from '../common/diff-ranges';
import { ANALYZABLE_EXTENSIONS } from '../common/language';
import { PrFeedbackFinding } from './pr-feedback.types';

const SEVERITY_BADGE: Record<string, { label: string; hex: string }> = {
  critical: { label: 'Critical', hex: 'c92a3d' },
  high: { label: 'High', hex: 'e8590c' },
  medium: { label: 'Medium', hex: 'b08a00' },
  low: { label: 'Low', hex: '2b5be3' },
};

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
 * One finding as a review comment: severity badge and title, what's wrong,
 * why, how to fix it (with the example patch as a highlighted code block),
 * and a footer naming the category, confidence and Audit Bench Ai.
 */
export function inlineCommentBody(f: PrFeedbackFinding): string {
  const badge = SEVERITY_BADGE[f.severity] ?? { label: f.severity, hex: '6b7280' };
  const lines = [
    `![${badge.label}](https://img.shields.io/badge/${encodeURIComponent(badge.label)}-${badge.hex}?style=flat-square) **${f.title}**`,
    '',
    f.description,
  ];
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
    f.category,
    typeof f.confidence === 'number' ? `${Math.round(f.confidence * 100)}% confidence` : null,
    'Audit Bench Ai',
  ].filter(Boolean);
  lines.push('', `<sub>${meta.join(' · ')}</sub>`);
  return lines.join('\n');
}
