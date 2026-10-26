import { PatternFinding } from './types';

/** Languages with no linter in Stage 1 (JS/TS have ESLint + tsc, Python has python-check). */
const PATTERN_LANGUAGE = /\.(cs|cshtml|razor|vb|java|kt|kts|go|php|rb|rs|scala|swift)$/i;

const RULES: Array<Omit<PatternFinding, 'line'> & { pattern: RegExp }> = [
  {
    pattern: /AuthorizationLevel\.Anonymous/,
    ruleId: 'dotnet/anonymous-function',
    title: 'This endpoint can be called by anyone, with no key or login',
    message:
      'The Azure Function uses AuthorizationLevel.Anonymous, so anyone who finds the URL can call it. Use AuthorizationLevel.Function (or put it behind your login) unless it is meant to be public, and say so in a comment if it is.',
    severity: 'error',
  },
  {
    pattern: /\[AllowAnonymous\]/,
    ruleId: 'dotnet/allow-anonymous',
    title: 'This endpoint skips the login check',
    message: '[AllowAnonymous] turns off authentication for this endpoint. Confirm it is meant to be public.',
    severity: 'warning',
  },
  {
    pattern:
      /\b(SELECT|INSERT|UPDATE|DELETE)\b[^"'\n]*["']\s*\+|\+\s*["'][^"'\n]*\b(WHERE|AND|OR|VALUES|SET|IN)\b|\$@?"[^"\n]*\b(SELECT|INSERT|UPDATE|DELETE)\b[^"\n]*\{/i,
    ruleId: 'sql/string-built-query',
    title: 'SQL query built by joining strings',
    message:
      'Values are pasted into the SQL text, so crafted input can change the query (SQL injection). Pass them as query parameters instead (for example SqlParameter / @name).',
    severity: 'error',
  },
  {
    pattern: /\b(int|long|short|decimal|double)\.Parse\s*\(\s*(req|request|query|Request)\b/,
    ruleId: 'dotnet/unchecked-parse',
    title: 'Request input parsed without checking it',
    message:
      'Parse throws on bad input and accepts any value, including negatives. Use TryParse, return 400 Bad Request when it fails, and check the value is in the allowed range — don’t silently fall back to a default.',
    severity: 'warning',
  },
  {
    pattern: /\bBinaryFormatter\b|TypeNameHandling\.(All|Auto|Objects)/,
    ruleId: 'dotnet/unsafe-deserialization',
    title: 'Unsafe deserialization',
    message:
      'BinaryFormatter and TypeNameHandling let the data choose which types to create, which can run attacker code. Use System.Text.Json with fixed types.',
    severity: 'error',
  },
  {
    pattern: /ServerCertificate(CustomValidation|Validation)Callback\s*=.*=>\s*true|InsecureSkipVerify\s*:\s*true/,
    ruleId: 'tls/validation-disabled',
    title: 'TLS certificate checks turned off',
    message: 'Accepting every certificate lets anyone on the network read or change the traffic. Remove the override.',
    severity: 'error',
  },
  {
    pattern: /catch\s*(\(\s*Exception[^)]*\))?\s*\{\s*\}/,
    ruleId: 'errors/swallowed-exception',
    title: 'Error silently ignored',
    message: 'An empty catch hides failures. Log the error, or handle the specific exception you expect.',
    severity: 'warning',
  },
];

/**
 * Line-level checks for languages Stage 1 has no linter for (C#, Java, Go,
 * PHP…): the handful of patterns that are almost always worth a finding on
 * their own, such as an anonymous endpoint or SQL built from strings. Free,
 * and reported whether or not the AI reviews the file.
 */
export function runPatternCheck(code: string, filename: string): PatternFinding[] {
  if (!PATTERN_LANGUAGE.test(filename)) return [];
  const findings: PatternFinding[] = [];
  code.split('\n').forEach((line, i) => {
    for (const { pattern, ...rule } of RULES) {
      if (pattern.test(line)) findings.push({ ...rule, line: i + 1 });
    }
  });
  return findings;
}
