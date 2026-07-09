import { Linter } from 'eslint';
// @ts-expect-error — no bundled type declarations, but the runtime export is a valid flat-config parser.
import tsParser from '@typescript-eslint/parser';
import { LintFinding } from './types';

const linter = new Linter();

// Core, parser-only rules (no type information required) that correlate
// with real correctness/security problems rather than pure style —
// deliberately not a full recommended set, since arbitrary pasted
// snippets rarely have a real project config behind them.
const RULES: Record<string, 'warn' | 'error'> = {
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
  'no-debugger': 'error',
  'no-unreachable': 'warn',
  'no-constant-condition': 'warn',
  'no-cond-assign': 'warn',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-fallthrough': 'warn',
  'no-self-compare': 'warn',
  'no-empty': 'warn',
  eqeqeq: 'warn',
  'no-var': 'warn',
};

const config = {
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 'latest' as const,
    sourceType: 'module' as const,
  },
  rules: RULES,
};

export function runEslint(code: string, filename: string): LintFinding[] {
  try {
    const messages = linter.verify(code, config, { filename });
    return messages
      .filter((m) => m.ruleId) // drop parser-fatal entries; TS diagnostics cover syntax errors
      .map((m) => ({
        line: m.line,
        ruleId: m.ruleId,
        message: m.message,
        severity: m.severity === 2 ? ('error' as const) : ('warning' as const),
      }));
  } catch {
    return []; // unparseable — TS diagnostics will report the real syntax error
  }
}
