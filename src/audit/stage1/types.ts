export interface FunctionUnit {
  name: string;
  startLine: number;
  endLine: number;
  code: string;
  complexity: number;
  /** Names this function calls that are also declared elsewhere in the same file. */
  callsInFile: string[];
}

export interface LintFinding {
  line: number;
  ruleId: string | null;
  message: string;
  severity: 'warning' | 'error';
}

export interface PythonFinding {
  line: number;
  ruleId: string;
  message: string;
  severity: 'warning' | 'error';
}

/** A line-level rule hit for languages without a linter in Stage 1 — see pattern-check.ts. */
export interface PatternFinding {
  line: number;
  ruleId: string;
  title: string;
  message: string;
  severity: 'warning' | 'error';
}

export interface TsDiagnostic {
  line: number;
  message: string;
}

export interface RiskySignal {
  pattern: string;
  line: number;
  snippet: string;
}

export interface FunctionRisk {
  fn: FunctionUnit;
  score: number;
  reasons: string[];
}

export interface Stage1Result {
  lint: LintFinding[];
  python: PythonFinding[];
  /** Absent on results cached before pattern checks existed. */
  patterns?: PatternFinding[];
  tsDiagnostics: TsDiagnostic[];
  formatted: boolean;
  formattingSkipped: boolean;
  semgrep: { skipped: true; reason: string } | { skipped: false; findings: RiskySignal[] };
  functions: FunctionUnit[];
  riskyFunctions: FunctionRisk[];
  /** True when nothing in Stage 1 warranted an LLM call. */
  clean: boolean;
}

/**
 * Stage 1's result without function source: what gets stored with a report
 * and in the review cache. The code is only needed while the review runs
 * (to build the AI prompt); keeping it would mean storing customers' source.
 */
export function withoutSourceCode(stage1: Stage1Result): Stage1Result {
  const strip = (fn: FunctionUnit): FunctionUnit => ({ ...fn, code: '' });
  return {
    ...stage1,
    functions: stage1.functions.map(strip),
    riskyFunctions: stage1.riskyFunctions.map((r) => ({ ...r, fn: strip(r.fn) })),
  };
}
