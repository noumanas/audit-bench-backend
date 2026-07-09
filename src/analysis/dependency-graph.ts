import * as path from 'path';
import { ScannedFile, DependencyGraphResult } from './types';

const IMPORT_RE =
  /(?:import|export)(?:[^'"]*?)from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const INDEX_SUFFIXES = [
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
];

// TS's NodeNext/ESM resolution lets source import a sibling `.ts` file by
// its post-compilation `.js` name (e.g. `import './util.js'` resolving to
// `util.ts`) — common in modern TS projects. Without stripping the
// specifier's own extension first, appending '.ts' onto "util.js" yields
// the never-matching "util.js.ts".
const JS_FAMILY_EXTENSION = /\.(js|jsx|mjs|cjs)$/;

function resolveImport(fromPath: string, specifier: string, known: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null; // skip package imports — outside the scanned set

  const dir = path.posix.dirname(fromPath);
  const joined = path.posix.normalize(path.posix.join(dir, specifier));
  const candidates = JS_FAMILY_EXTENSION.test(joined)
    ? [joined, joined.replace(JS_FAMILY_EXTENSION, '')]
    : [joined];

  for (const candidate of candidates) {
    for (const suffix of RESOLVE_SUFFIXES) {
      if (known.has(candidate + suffix)) return candidate + suffix;
    }
    for (const suffix of INDEX_SUFFIXES) {
      if (known.has(candidate + suffix)) return candidate + suffix;
    }
  }
  return null;
}

export function buildDependencyGraph(files: ScannedFile[]): DependencyGraphResult {
  const jsFiles = files.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f.path));
  const known = new Set(jsFiles.map((f) => f.path));
  const graph: Record<string, string[]> = {};

  for (const file of jsFiles) {
    const edges = new Set<string>();
    let match: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(file.content))) {
      const specifier = match[1] || match[2] || match[3];
      if (!specifier) continue;
      const resolved = resolveImport(file.path, specifier, known);
      if (resolved && resolved !== file.path) edges.add(resolved);
    }
    graph[file.path] = [...edges];
  }

  return { graph, circular: findCycles(graph) };
}

function findCycles(graph: Record<string, string[]>): string[][] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const cycles: string[][] = [];
  const seen = new Set<string>();

  function visit(node: string, stack: string[]) {
    color.set(node, GRAY);
    stack.push(node);

    for (const neighbor of graph[node] || []) {
      const state = color.get(neighbor) ?? WHITE;
      if (state === WHITE) {
        visit(neighbor, stack);
      } else if (state === GRAY) {
        const idx = stack.indexOf(neighbor);
        const cycle = stack.slice(idx);
        const key = [...cycle].sort().join('|');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push([...cycle, neighbor]);
        }
      }
    }

    stack.pop();
    color.set(node, BLACK);
  }

  for (const node of Object.keys(graph)) {
    if ((color.get(node) ?? WHITE) === WHITE) visit(node, []);
  }

  return cycles.slice(0, 20);
}
