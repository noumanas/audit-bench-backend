import { createHash } from 'crypto';
import { ScannedFile, DuplicateGroup } from './types';

const CHUNK_LINES = 8;
const MIN_NON_BLANK_LINES = 5;

function normalize(line: string): string {
  return line.trim().replace(/\s+/g, ' ');
}

// Lines every file in a language shares: imports, braces, attributes,
// namespace/region markers. A chunk of these is boilerplate, not duplication.
const BOILERPLATE =
  /^(using\s|import\s|from\s+\S+\s+import|#include|#region|#endregion|namespace\s|package\s|require\(|[{}()\[\];,]+$|\[[\w.]+(\(.*\))?\]$|\/\/|\*|\/\*|')/;

/** Source code only: config, markup and resource files repeat by design. */
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|rb|php|cs|vb|fs|rs|swift|scala|c|cc|cpp|h)$/i;

export function findDuplicates(files: ScannedFile[]): DuplicateGroup[] {
  const buckets = new Map<
    string,
    { path: string; startLine: number; endLine: number }[]
  >();

  for (const file of files) {
    if (!CODE_FILE.test(file.path)) continue;
    const lines = file.content.split('\n');
    for (let start = 0; start + CHUNK_LINES <= lines.length; start += CHUNK_LINES) {
      const chunk = lines.slice(start, start + CHUNK_LINES);
      const normalized = chunk.map(normalize);
      const meaningful = normalized.filter((l) => l.length > 0 && !BOILERPLATE.test(l));
      if (meaningful.length < MIN_NON_BLANK_LINES) continue;

      const hash = createHash('sha1').update(normalized.join('\n')).digest('hex');
      const entry = { path: file.path, startLine: start + 1, endLine: start + CHUNK_LINES };
      const bucket = buckets.get(hash);
      if (bucket) bucket.push(entry);
      else buckets.set(hash, [entry]);
    }
  }

  const groups: DuplicateGroup[] = [];
  for (const occurrences of buckets.values()) {
    if (occurrences.length < 2) continue;
    groups.push({ linesOfCode: CHUNK_LINES, occurrences });
  }

  return groups
    .sort((a, b) => b.occurrences.length - a.occurrences.length)
    .slice(0, 10);
}
