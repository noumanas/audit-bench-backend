import { FunctionUnit } from './types';

/** Languages whose functions are `{ … }` blocks, split by brace matching. */
const BRACE_LANGUAGE = /\.(cs|java|kt|kts|go|php|rs|swift|scala|c|cc|cpp|h|hpp|m)$/i;
const PYTHON = /\.(py|pyi)$/i;
/** Code with no reliable text split (Ruby, VB, Razor…): reviewed as one unit. */
const WHOLE_FILE_LANGUAGE = /\.(rb|vb|fs|cshtml|razor)$/i;

/** A whole-file unit is cut here, so one huge unsplittable file can't balloon the AI prompt. */
const MAX_FILE_UNIT_LINES = 300;

// A line that opens a named function or method: an identifier followed by
// "(" that isn't a control-flow keyword or a call statement ending in ";".
const SIGNATURE = /^\s*(?:\[[^\]]*\]\s*)*(?:[\w<>[\],.?:@*&\s]+\s+)?(?:func\s+(?:\([^)]*\)\s*)?)?(?:function\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(/;
const NOT_A_FUNCTION = /^\s*(if|else|for|foreach|while|switch|catch|using|lock|return|throw|new|await|yield|do|try|fixed|checked|unchecked|case)\b/;
const BRANCH = /\b(if|else if|for|foreach|while|case|catch|elif|except)\b|&&|\|\||\?\?|\?(?!\.)/g;

function complexityOf(code: string): number {
  return 1 + (code.match(BRANCH)?.length ?? 0);
}

function wholeFile(code: string): FunctionUnit[] {
  const lines = code.split('\n');
  const end = Math.min(lines.length, MAX_FILE_UNIT_LINES);
  const unit = lines.slice(0, end).join('\n');
  return [{ name: '(file)', startLine: 1, endLine: end, code: unit, complexity: complexityOf(unit), callsInFile: [] }];
}

/** Brace depth change on one line, ignoring braces inside simple string and char literals and // comments. */
function braceDelta(line: string): { opens: number; closes: number } {
  const stripped = line
    .replace(/\/\/.*$/, '')
    .replace(/@?"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");
  return { opens: (stripped.match(/\{/g) ?? []).length, closes: (stripped.match(/\}/g) ?? []).length };
}

function splitBraceFunctions(code: string): FunctionUnit[] {
  const lines = code.split('\n');
  const units: FunctionUnit[] = [];
  let i = 0;
  while (i < lines.length) {
    const m = SIGNATURE.exec(lines[i]);
    if (!m || NOT_A_FUNCTION.test(lines[i]) || /;\s*$/.test(lines[i])) {
      i++;
      continue;
    }
    // The body's "{" is on the signature line or within the next 3 (wrapped parameters, attributes).
    let open = -1;
    for (let j = i; j < Math.min(lines.length, i + 4); j++) {
      if (/;\s*$/.test(lines[j]) && j > i) break;
      if (braceDelta(lines[j]).opens > 0) {
        open = j;
        break;
      }
    }
    if (open === -1) {
      i++;
      continue;
    }
    let depth = 0;
    let end = -1;
    for (let j = open; j < lines.length; j++) {
      const { opens, closes } = braceDelta(lines[j]);
      depth += opens - closes;
      if (depth <= 0) {
        end = j;
        break;
      }
    }
    if (end === -1) break;
    const body = lines.slice(i, end + 1).join('\n');
    // A class or namespace also matches "Name(" rarely; only keep blocks that read like one function.
    if (end - i + 1 <= 400) {
      units.push({
        name: m[1],
        startLine: i + 1,
        endLine: end + 1,
        code: body,
        complexity: complexityOf(body),
        callsInFile: [],
      });
      i = end + 1;
    } else {
      i++;
    }
  }
  return units;
}

function splitPythonFunctions(code: string): FunctionUnit[] {
  const lines = code.split('\n');
  const units: FunctionUnit[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:async\s+)?def\s+(\w+)\s*\(/.exec(lines[i]);
    if (!m) continue;
    const indent = m[1].length;
    let end = i;
    for (let j = i + 1; j < lines.length; j++) {
      if (!lines[j].trim()) continue;
      if (lines[j].length - lines[j].trimStart().length <= indent) break;
      end = j;
    }
    const body = lines.slice(i, end + 1).join('\n');
    units.push({ name: m[2], startLine: i + 1, endLine: end + 1, code: body, complexity: complexityOf(body), callsInFile: [] });
  }
  return units;
}

function fillCallsInFile(units: FunctionUnit[]): FunctionUnit[] {
  const names = new Set(units.map((u) => u.name));
  return units.map((u) => ({
    ...u,
    callsInFile: [...names].filter((n) => n !== u.name && new RegExp(`\\b${n}\\s*\\(`).test(u.code)),
  }));
}

/**
 * Function units for languages the TypeScript AST can't parse (C#, Java,
 * Go, PHP, Kotlin, Python…), found by text: brace matching for C-like
 * languages, indentation for Python. Approximate on purpose — it's a triage
 * signal for what to send to the AI, not a compiler. Falls back to the file
 * itself (first MAX_FILE_UNIT_LINES lines) when no function is found. Config
 * and data files (JSON, YAML, SQL…) get no units: secrets in them are the
 * secrets scanner's job.
 */
export function splitBlockFunctions(code: string, filename: string): FunctionUnit[] {
  if (WHOLE_FILE_LANGUAGE.test(filename)) return wholeFile(code);
  if (!PYTHON.test(filename) && !BRACE_LANGUAGE.test(filename)) return [];
  const units = PYTHON.test(filename) ? splitPythonFunctions(code) : splitBraceFunctions(code);
  return units.length ? fillCallsInFile(units) : wholeFile(code);
}
