/** Words that carry no meaning about which kind of issue a finding is. */
const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'be', 'can', 'may', 'might', 'could', 'will', 'of', 'in', 'on', 'to', 'for',
  'from', 'with', 'and', 'or', 'not', 'no', 'this', 'that', 'it', 'its', 'when', 'if', 'by', 'as', 'at',
]);

/**
 * "The same kind of finding", stable across re-reviews and small wording
 * changes: the category plus the title's meaningful words, with code
 * identifiers, quoted text and numbers removed (so "`userId` is never
 * checked" and "`orgId` is never checked" match), sorted and capped.
 */
export function findingFingerprint(f: { category?: string | null; title: string }): string {
  const words = f.title
    .toLowerCase()
    .replace(/`[^`]*`|"[^"]*"|'[^']*'/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  const unique = [...new Set(words)].sort().slice(0, 8);
  return `${(f.category ?? 'any').toLowerCase()}:${unique.join('-')}`;
}

/**
 * Glob match for path rules: "**" spans directories, "*" stays within one,
 * "?" is one character. A pattern with no "/" matches the file name at any
 * depth ("*.generated.ts"); one ending in "/" matches everything under it.
 */
export function matchesGlob(path: string, pattern: string): boolean {
  let p = pattern.trim().replace(/^\.?\//, '');
  if (!p) return false;
  if (p.endsWith('/')) p += '**';
  if (!p.includes('/')) p = `**/${p}`;
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      // "**/" may also match nothing, so "**/x" matches "x" at the root.
      if (p[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`).test(path);
}
