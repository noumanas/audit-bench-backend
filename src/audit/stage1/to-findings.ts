import { Finding } from '../../common/types';
import { FunctionUnit, Stage1Result } from './types';
import { DEFAULT_THRESHOLDS, ReviewThresholds } from '../../common/review-thresholds';

/** Below this, branch count alone never earns a finding. */
const COMPLEXITY_FLOOR = 10;

/**
 * A maintainability finding for a complex function, only when there's
 * evidence it's actually hard to maintain: deep nesting, or a very large
 * number of branches. A flat function whose many branches each handle one
 * case (a mapper normalizing optional fields) is left alone; splitting it
 * would add indirection, not clarity. Functions sent to the AI review are
 * judged there with the code in view instead.
 */
export function complexityFinding(fn: FunctionUnit, t: ReviewThresholds = DEFAULT_THRESHOLDS): Finding | null {
  if (fn.complexity <= COMPLEXITY_FLOOR) return null;
  const nesting = fn.maxNesting ?? 0;
  const deep = nesting >= t.deepNesting;
  if (!deep && fn.complexity < t.veryHighComplexity) return null;

  const span = `lines ${fn.startLine}-${fn.endLine}`;
  return deep
    ? {
        severity: 'low',
        category: 'Maintainability',
        title: `Deeply nested conditions in ${fn.name}()`,
        line: fn.startLine,
        endLine: fn.endLine,
        description: `${fn.name}() (${span}) nests conditions ${nesting} levels deep, with ${fn.complexity} paths through it. At that depth it is hard to see which conditions hold at any line, which is where missed edge cases tend to hide.`,
        rootCause: 'Conditions are handled by nesting further rather than exiting early.',
        suggestedFix:
          'Return early for the simple cases so the main path sits at one level, or move the innermost nested block into a named helper. Make sure each path has a test before restructuring.',
        examplePatch: null,
        confidence: 0.65,
      }
    : {
        severity: 'low',
        category: 'Maintainability',
        title: `Very large number of branches in ${fn.name}()`,
        line: fn.startLine,
        endLine: fn.endLine,
        description: `${fn.name}() (${span}) has ${fn.complexity} paths through it. The branches are not deeply nested, so this is only worth changing if they handle unrelated jobs or the function keeps growing.`,
        rootCause: 'Many cases are handled in one function.',
        suggestedFix:
          'If the branches map inputs to outputs, a lookup table can replace them. If they do unrelated jobs, separate those jobs. Otherwise no change is needed.',
        examplePatch: null,
        confidence: 0.5,
      };
}

/**
 * Turns Stage 1's raw signals into the same Finding shape an LLM produces,
 * so a purely-local (no AI, no cost) run still returns something useful —
 * not just a diagnostic dump.
 */
export function stage1ToFindings(stage1: Stage1Result, thresholds: ReviewThresholds = DEFAULT_THRESHOLDS): Finding[] {
  const findings: Finding[] = [];

  for (const d of stage1.tsDiagnostics) {
    findings.push({
      severity: 'high',
      category: 'Logic',
      title: 'TypeScript compile error',
      line: d.line || null,
      description: d.message,
      rootCause: 'The code does not compile as written.',
      suggestedFix: 'Fix the compiler error before this can run.',
      examplePatch: null,
      confidence: 1,
    });
  }

  for (const p of stage1.python) {
    findings.push({
      severity: p.severity === 'error' ? 'high' : 'medium',
      category: 'Security',
      title: `Python check: ${p.ruleId}`,
      line: p.line || null,
      description: p.message,
      rootCause: 'Python local audit matched a risky pattern.',
      suggestedFix: 'Review the code path and replace the risky pattern with a safer alternative.',
      examplePatch: null,
      confidence: p.severity === 'error' ? 0.9 : 0.75,
    });
  }

  for (const p of stage1.patterns ?? []) {
    findings.push({
      severity: p.severity === 'error' ? 'high' : 'medium',
      category: p.ruleId.startsWith('errors/') ? 'Logic' : 'Security',
      title: p.title,
      line: p.line || null,
      description: p.message,
      rootCause: `Matched the local rule ${p.ruleId}.`,
      suggestedFix: p.message,
      examplePatch: null,
      confidence: p.severity === 'error' ? 0.85 : 0.7,
    });
  }

  for (const l of stage1.lint) {
    if (l.severity !== 'error') continue;
    findings.push({
      severity: 'medium',
      category: 'Logic',
      title: `Lint error: ${l.ruleId ?? 'unknown rule'}`,
      line: l.line || null,
      description: l.message,
      rootCause: `Violates the ${l.ruleId ?? ''} rule.`,
      suggestedFix: 'Address the lint error.',
      examplePatch: null,
      confidence: 0.9,
    });
  }

  // riskyFunctions is a routing signal (which functions get sent to Stage
  // 2), not a user-facing finding — whenever it's non-empty, Stage 2 runs
  // and produces the real, specific finding for that function instead.

  if (!stage1.semgrep.skipped) {
    for (const s of stage1.semgrep.findings) {
      findings.push({
        severity: 'medium',
        category: 'Security',
        title: `Semgrep: ${s.pattern}`,
        line: s.line || null,
        description: s.snippet || s.pattern,
        rootCause: 'Matched a Semgrep security rule.',
        suggestedFix: 'Review the flagged pattern.',
        examplePatch: null,
        confidence: 0.75,
      });
    }
  }

  for (const fn of stage1.functions) {
    if (stage1.riskyFunctions.some((r) => r.fn.name === fn.name)) continue;
    const finding = complexityFinding(fn, thresholds);
    if (finding) findings.push(finding);
  }

  return findings;
}
