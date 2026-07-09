"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDependencyGraph = buildDependencyGraph;
const path = require("path");
const IMPORT_RE = /(?:import|export)(?:[^'"]*?)from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const INDEX_SUFFIXES = [
    '/index.ts',
    '/index.tsx',
    '/index.js',
    '/index.jsx',
];
const JS_FAMILY_EXTENSION = /\.(js|jsx|mjs|cjs)$/;
function resolveImport(fromPath, specifier, known) {
    if (!specifier.startsWith('.'))
        return null;
    const dir = path.posix.dirname(fromPath);
    const joined = path.posix.normalize(path.posix.join(dir, specifier));
    const candidates = JS_FAMILY_EXTENSION.test(joined)
        ? [joined, joined.replace(JS_FAMILY_EXTENSION, '')]
        : [joined];
    for (const candidate of candidates) {
        for (const suffix of RESOLVE_SUFFIXES) {
            if (known.has(candidate + suffix))
                return candidate + suffix;
        }
        for (const suffix of INDEX_SUFFIXES) {
            if (known.has(candidate + suffix))
                return candidate + suffix;
        }
    }
    return null;
}
function buildDependencyGraph(files) {
    const jsFiles = files.filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f.path));
    const known = new Set(jsFiles.map((f) => f.path));
    const graph = {};
    for (const file of jsFiles) {
        const edges = new Set();
        let match;
        IMPORT_RE.lastIndex = 0;
        while ((match = IMPORT_RE.exec(file.content))) {
            const specifier = match[1] || match[2] || match[3];
            if (!specifier)
                continue;
            const resolved = resolveImport(file.path, specifier, known);
            if (resolved && resolved !== file.path)
                edges.add(resolved);
        }
        graph[file.path] = [...edges];
    }
    return { graph, circular: findCycles(graph) };
}
function findCycles(graph) {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map();
    const cycles = [];
    const seen = new Set();
    function visit(node, stack) {
        color.set(node, GRAY);
        stack.push(node);
        for (const neighbor of graph[node] || []) {
            const state = color.get(neighbor) ?? WHITE;
            if (state === WHITE) {
                visit(neighbor, stack);
            }
            else if (state === GRAY) {
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
        if ((color.get(node) ?? WHITE) === WHITE)
            visit(node, []);
    }
    return cycles.slice(0, 20);
}
//# sourceMappingURL=dependency-graph.js.map