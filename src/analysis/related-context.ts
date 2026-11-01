import { LineRange } from '../common/diff-ranges';
import { ScannedFile } from './types';

/** Lines above a hunk to look for the function or class it sits in. */
const ENCLOSING_LOOKBACK = 80;
const MAX_SYMBOLS_PER_FILE = 8;
const MAX_USAGES_PER_SYMBOL = 4;
/** The most related-code lines one file's review is shown. */
const MAX_CONTEXT_LINES = 60;

type Lang = 'js' | 'py' | 'go' | 'rust' | 'jvm' | 'cs' | 'rb' | 'php';

const EXT_LANG: Record<string, Lang> = {
  ts: 'js',
  tsx: 'js',
  js: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  py: 'py',
  pyi: 'py',
  go: 'go',
  rs: 'rust',
  java: 'jvm',
  kt: 'jvm',
  kts: 'jvm',
  scala: 'jvm',
  cs: 'cs',
  rb: 'rb',
  php: 'php',
};

const CLASS_LIKE = /\b(?:class|interface|enum|struct|trait|object|record)\s+([A-Za-z_$][\w$]*)/;

/**
 * Definition patterns per language, each capturing the defined name.
 * Deliberately simple: a missed definition only means less context, never a
 * wrong review.
 */
const DEFINITIONS: Record<Lang, RegExp[]> = {
  js: [
    /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/,
    /\b(?:class|interface|enum|type)\s+([A-Za-z_$][\w$]*)/,
    /^\s*(?:export\s+)?(?:(?:public|private|protected|static|async|override|readonly)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
  ],
  py: [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, /^\s*class\s+([A-Za-z_]\w*)/],
  go: [/^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*[(\[]/, /^\s*type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/],
  rust: [
    /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([A-Za-z_]\w*)/,
    /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/,
  ],
  jvm: [
    /^\s*(?:(?:public|private|protected|internal|static|final|abstract|override|suspend|open|inline)\s+)*fun\s+(?:<[^>]+>\s*)?(?:[\w.]+\.)?([A-Za-z_]\w*)\s*\(/,
    /^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|default)\s+)+[\w<>[\],.?\s]+?\s+([A-Za-z_]\w*)\s*\([^;]*$/,
    CLASS_LIKE,
  ],
  cs: [
    /^\s*(?:(?:public|private|protected|internal|static|virtual|override|abstract|async|sealed)\s+)+[\w<>[\],.?\s]+?\s+([A-Za-z_]\w*)\s*\([^;]*$/,
    CLASS_LIKE,
  ],
  rb: [/^\s*def\s+(?:self\.)?([A-Za-z_]\w*[?!]?)/, /^\s*(?:class|module)\s+([A-Za-z_]\w*)/],
  php: [/\bfunction\s+([A-Za-z_]\w*)\s*\(/, /\b(?:class|interface|trait|enum)\s+([A-Za-z_]\w*)/],
};

/** Names too generic to search a codebase for. */
const SKIP = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'function',
  'constructor',
  'render',
  'main',
  'init',
  'get',
  'set',
  'run',
  'test',
  'it',
  'describe',
  'handle',
  'index',
  'default',
  'new',
  'then',
  'map',
  'filter',
  'call',
  'apply',
  'toString',
  'equals',
  'hashCode',
  'setUp',
  'tearDown',
  'self',
  'this',
  'super',
  'ngOnInit',
  'useEffect',
  '__init__',
]);

const COMMENT = /^\s*(?:#|\/\/|\/?\*|"""|''')/;
const TEST_PATH =
  /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[a-z]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$|Tests?\.(java|kt|cs)$/i;

function langOf(path: string): Lang | null {
  return EXT_LANG[path.split('.').pop()?.toLowerCase() ?? ''] ?? null;
}

function definedName(line: string, lang: Lang): string | null {
  if (COMMENT.test(line)) return null;
  for (const re of DEFINITIONS[lang]) {
    const m = re.exec(line);
    if (m?.[1] && m[1].length >= 3 && !SKIP.has(m[1])) return m[1];
  }
  return null;
}

/**
 * Functions, classes and types a PR touches in one file: those defined on a
 * changed line, plus the one each changed hunk sits inside. Test files give
 * none — nothing else calls into them.
 */
export function changedSymbols(content: string, ranges: LineRange[], path = 'file.ts'): string[] {
  const lang = langOf(path);
  if (!lang || TEST_PATH.test(path)) return [];
  const lines = content.split('\n');
  const found: string[] = [];
  const add = (name: string | null) => {
    if (name && !found.includes(name)) found.push(name);
  };
  for (const r of ranges) {
    for (let n = r.start; n <= Math.min(r.end, lines.length); n++) add(definedName(lines[n - 1] ?? '', lang));
    for (let n = r.start - 1; n >= Math.max(1, r.start - ENCLOSING_LOOKBACK); n--) {
      const name = definedName(lines[n - 1] ?? '', lang);
      if (name) {
        add(name);
        break;
      }
    }
  }
  return found.slice(0, MAX_SYMBOLS_PER_FILE);
}

/**
 * Where the changed symbols are used in the rest of the repository (same
 * language only), as numbered snippets for the AI: a PR that changes a
 * function's behaviour or signature can break callers the diff never shows.
 * Text search, so a common name can over-match; definitions and comments
 * are skipped.
 */
export function relatedContextFor(changed: ScannedFile, repoFiles: ScannedFile[]): string {
  const lang = langOf(changed.path);
  if (!lang || !changed.changedRanges?.length) return '';
  const symbols = changedSymbols(changed.content, changed.changedRanges, changed.path);
  if (!symbols.length) return '';
  const sameLanguage = repoFiles.filter((f) => f.path !== changed.path && langOf(f.path) === lang);

  const sections: string[] = [];
  let budget = MAX_CONTEXT_LINES;
  for (const symbol of symbols) {
    if (budget <= 0) break;
    const word = new RegExp(`(^|[^\\w$])${symbol.replace(/[$?!]/g, '\\$&')}(?![\\w$])`);
    const hits: string[] = [];
    for (const file of sameLanguage) {
      if (hits.length >= MAX_USAGES_PER_SYMBOL || budget <= 0) break;
      if (!file.content.includes(symbol)) continue;
      const lines = file.content.split('\n');
      for (let i = 0; i < lines.length && hits.length < MAX_USAGES_PER_SYMBOL && budget > 0; i++) {
        const line = lines[i];
        if (line.length > 300 || COMMENT.test(line) || !word.test(line) || definedName(line, lang) === symbol) continue;
        hits.push(`${file.path}:${i + 1} | ${line.trim()}`);
        budget--;
      }
    }
    if (hits.length) sections.push(`\`${symbol}\` is used in:\n${hits.join('\n')}`);
  }
  return sections.length
    ? `Unchanged code elsewhere in the repository that uses what this file's changes touch (check the change doesn't break these):\n${sections.join('\n\n')}`
    : '';
}

/** The most test lines one file's review is shown. */
const MAX_TEST_CONTEXT_LINES = 40;
const MAX_TEST_FILES_PER_SYMBOL = 3;
/** Lines that name a test case or group, in the common frameworks. */
const TEST_CASE =
  /\b(?:it|test|describe|context)(?:\.\w+)?\s*\(\s*['"`]|^\s*(?:async\s+)?def\s+test_\w*|^\s*func\s+Test\w*|@Test\b|\[(?:Fact|Test|Theory)\]/;

/**
 * Evidence about tests for a PR's changed code: the test files that mention
 * each changed function or class, with the test cases that do, so the review
 * can judge coverage instead of guessing. When a text search finds no test
 * mentioning anything that changed, it says so — the reviewer may still
 * recommend coverage, but knows it isn't contradicting a test it can't see.
 */
export function testContextFor(changed: ScannedFile, repoFiles: ScannedFile[]): string {
  if (!changed.changedRanges?.length || TEST_PATH.test(changed.path)) return '';
  const symbols = changedSymbols(changed.content, changed.changedRanges, changed.path);
  if (!symbols.length) return '';
  const tests = repoFiles.filter((f) => f.path !== changed.path && TEST_PATH.test(f.path));

  const sections: string[] = [];
  const untested: string[] = [];
  let budget = MAX_TEST_CONTEXT_LINES;
  for (const symbol of symbols) {
    const word = new RegExp(`(^|[^\\w$])${symbol.replace(/[$?!]/g, '\\$&')}(?![\\w$])`);
    const files = tests.filter((f) => f.content.includes(symbol) && word.test(f.content)).slice(0, MAX_TEST_FILES_PER_SYMBOL);
    if (!files.length) {
      untested.push(symbol);
      continue;
    }
    const hits: string[] = [];
    for (const file of files) {
      const lines = file.content.split('\n');
      // The test cases that use the symbol: the nearest case title above each use.
      const cases = new Set<number>();
      for (let i = 0; i < lines.length; i++) {
        if (!word.test(lines[i])) continue;
        for (let j = i; j >= 0 && j >= i - 40; j--) {
          if (TEST_CASE.test(lines[j])) {
            cases.add(j);
            break;
          }
        }
      }
      for (const n of [...cases].slice(0, 6)) {
        if (budget <= 0) break;
        hits.push(`${file.path}:${n + 1} | ${lines[n].trim().slice(0, 200)}`);
        budget--;
      }
      if (!cases.size && budget > 0) {
        hits.push(`${file.path} mentions it (no test case title found near the use)`);
        budget--;
      }
    }
    if (hits.length) sections.push(`\`${symbol}\` is exercised by:\n${hits.join('\n')}`);
  }

  const parts: string[] = [];
  if (sections.length) parts.push(`Tests in the repository that exercise the changed code (test case titles):\n${sections.join('\n\n')}`);
  if (untested.length) {
    parts.push(
      `A text search of the repository's test files found no test mentioning: ${untested.map((s) => `\`${s}\``).join(', ')}.`,
    );
  }
  return parts.join('\n\n');
}
