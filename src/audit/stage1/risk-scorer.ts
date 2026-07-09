import { FunctionRisk, FunctionUnit, LintFinding } from './types';

// Text patterns that correlate with the kinds of bugs an LLM pass is
// actually worth paying for — not an exhaustive vulnerability list, just a
// triage signal. Deliberately language-agnostic (plain string/regex match)
// since a scanned repo may not be JS/TS.
const RISKY_PATTERNS: { pattern: RegExp; reason: string; weight: number }[] = [
  { pattern: /\beval\s*\(/, reason: 'eval()', weight: 5 },
  { pattern: /\bnew Function\s*\(/, reason: 'dynamic Function construction', weight: 5 },
  { pattern: /\b(exec|execSync|spawn|spawnSync)\s*\(/, reason: 'shell/process execution', weight: 4 },
  { pattern: /dangerouslySetInnerHTML/, reason: 'dangerouslySetInnerHTML', weight: 4 },
  { pattern: /\.innerHTML\s*=/, reason: 'raw innerHTML assignment', weight: 3 },
  { pattern: /document\.write\s*\(/, reason: 'document.write', weight: 3 },
  { pattern: /\bSELECT\b.*\$\{|\bINSERT\b.*\$\{|\bUPDATE\b.*\$\{|\bDELETE\b.*\$\{/i, reason: 'string-interpolated SQL', weight: 5 },
  { pattern: /createClient\([^)]*SERVICE_ROLE/i, reason: 'service-role key usage', weight: 4 },
  { pattern: /jwt\.(sign|verify)\s*\(/, reason: 'JWT sign/verify', weight: 3 },
  { pattern: /(password|secret|token|apiKey)\s*[:=]\s*['"][^'"]{8,}['"]/i, reason: 'possible hardcoded credential', weight: 5 },
  { pattern: /\bMath\.random\s*\(\s*\)/, reason: 'Math.random() used where crypto randomness may matter', weight: 2 },
  { pattern: /\bcreateHash\s*\(\s*['"](md5|sha1)['"]/, reason: 'weak hash algorithm', weight: 3 },
  { pattern: /localStorage\.(setItem|getItem)/, reason: 'localStorage access', weight: 1 },
  { pattern: /fetch\s*\(\s*[^)'"`]/, reason: 'dynamically constructed request URL', weight: 2 },
  { pattern: /\bos\.system\s*\(|subprocess\./, reason: 'shell execution (Python)', weight: 4 },
];

const COMPLEXITY_THRESHOLD = 10;
const MAX_ESCALATED_FUNCTIONS = 5;

function scoreFunction(fn: FunctionUnit, lint: LintFinding[]): FunctionRisk {
  const reasons: string[] = [];
  let score = 0;

  for (const { pattern, reason, weight } of RISKY_PATTERNS) {
    if (pattern.test(fn.code)) {
      score += weight;
      reasons.push(reason);
    }
  }

  if (fn.complexity > COMPLEXITY_THRESHOLD) {
    score += Math.min(5, Math.floor((fn.complexity - COMPLEXITY_THRESHOLD) / 2) + 2);
    reasons.push(`high cyclomatic complexity (${fn.complexity})`);
  }

  const inRange = lint.filter((l) => l.line >= fn.startLine && l.line <= fn.endLine);
  const errorCount = inRange.filter((l) => l.severity === 'error').length;
  if (errorCount > 0) {
    score += errorCount * 2;
    reasons.push(`${errorCount} lint error(s) in range`);
  }

  return { fn, score, reasons };
}

/**
 * Ranks every function by risk and returns the subset worth sending to the
 * LLM — capped so a large file can't balloon into a huge Stage 2 prompt.
 * A score of 0 means nothing here justifies AI spend at all.
 */
export function selectRiskyFunctions(functions: FunctionUnit[], lint: LintFinding[]): FunctionRisk[] {
  return functions
    .map((fn) => scoreFunction(fn, lint))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_ESCALATED_FUNCTIONS);
}
