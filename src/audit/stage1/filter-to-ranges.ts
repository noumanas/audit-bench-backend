import { LineRange, overlapsAny } from '../../common/diff-ranges';
import { Stage1Result } from './types';

/**
 * Scopes a Stage 1 result down to only what falls within a PR/MR's changed
 * line ranges — so a diff review reports on (and can escalate) only what
 * this change actually touched, not pre-existing issues elsewhere in the
 * file. `functions` is left untouched: a risky function inside the diff
 * might call a helper outside it, and Stage 2 still needs that helper's
 * signature for context.
 */
export function filterStage1ToRanges(stage1: Stage1Result, ranges: LineRange[]): Stage1Result {
  const riskyFunctions = stage1.riskyFunctions.filter((r) => overlapsAny(r.fn.startLine, r.fn.endLine, ranges));
  const tsDiagnostics = stage1.tsDiagnostics.filter((d) => overlapsAny(d.line, d.line, ranges));
  const lint = stage1.lint.filter((l) => overlapsAny(l.line, l.line, ranges));
  const semgrep = stage1.semgrep.skipped
    ? stage1.semgrep
    : { skipped: false as const, findings: stage1.semgrep.findings.filter((f) => overlapsAny(f.line, f.line, ranges)) };

  const semgrepFlagged = !semgrep.skipped && semgrep.findings.length > 0;

  return {
    ...stage1,
    lint,
    tsDiagnostics,
    semgrep,
    riskyFunctions,
    clean: riskyFunctions.length === 0 && tsDiagnostics.length === 0 && !semgrepFlagged,
  };
}
