/**
 * Scoring for the review benchmark (see benchmark/run.ts): known bugs seeded
 * into realistic pull request changes, plus clean changes as controls.
 */

export interface BenchmarkCase {
  id: string;
  title: string;
  path: string;
  code: string;
  /** The lines the "pull request" changed, 1-based and inclusive. */
  changed: Array<{ start: number; end: number }>;
  /** Seeded bugs, located by a unique substring of the buggy line (no hints in the code itself). Empty for a clean change. */
  bugs: Array<{ at: string; what: string }>;
}

export interface ReportedFinding {
  line: number | null;
  endLine?: number | null;
  severity: string;
  title: string;
}

export interface CaseResult {
  id: string;
  title: string;
  clean: boolean;
  caught: string[];
  missed: string[];
  /** Medium-or-worse findings that don't match a seeded bug (on a clean case, every one). */
  falsePositives: ReportedFinding[];
}

/** A finding within this many lines of a seeded bug counts as catching it. */
export const LINE_TOLERANCE = 3;
const COUNTS = new Set(['critical', 'high', 'medium']);

/** 1-based line number of the first line containing `needle`. */
export function lineOf(code: string, needle: string): number {
  const i = code.split('\n').findIndex((l) => l.includes(needle));
  if (i < 0) throw new Error(`Benchmark case is broken: "${needle}" isn't in the code`);
  return i + 1;
}

export function scoreCase(c: BenchmarkCase, findings: ReportedFinding[]): CaseResult {
  const serious = findings.filter((f) => COUNTS.has(f.severity) && f.line != null);
  const near = (f: ReportedFinding, line: number) => {
    const start = f.line as number;
    const end = f.endLine && f.endLine > start ? f.endLine : start;
    return line >= start - LINE_TOLERANCE && line <= end + LINE_TOLERANCE;
  };
  const bugLines = c.bugs.map((b) => ({ ...b, line: lineOf(c.code, b.at) }));
  const caught = bugLines.filter((b) => serious.some((f) => near(f, b.line))).map((b) => b.what);
  const missed = bugLines.filter((b) => !caught.includes(b.what)).map((b) => b.what);
  const falsePositives = serious.filter((f) => !bugLines.some((b) => near(f, b.line)));
  return { id: c.id, title: c.title, clean: c.bugs.length === 0, caught, missed, falsePositives };
}

export function summarize(results: CaseResult[]) {
  const bugs = results.reduce((n, r) => n + r.caught.length + r.missed.length, 0);
  const caught = results.reduce((n, r) => n + r.caught.length, 0);
  const cleanCases = results.filter((r) => r.clean);
  const flaggedClean = cleanCases.filter((r) => r.falsePositives.length > 0).length;
  const falsePositives = results.reduce((n, r) => n + r.falsePositives.length, 0);
  return {
    bugs,
    caught,
    catchRate: bugs ? caught / bugs : 0,
    cleanCases: cleanCases.length,
    flaggedClean,
    /** Share of clean changes that got at least one medium-or-worse finding. */
    cleanFalseAlarmRate: cleanCases.length ? flaggedClean / cleanCases.length : 0,
    falsePositives,
  };
}
