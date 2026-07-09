"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANALYZABLE_EXTENSIONS = void 0;
exports.detectLanguage = detectLanguage;
const EXTENSION_MAP = {
    ts: 'TypeScript',
    tsx: 'TypeScript (React)',
    js: 'JavaScript',
    jsx: 'JavaScript (React)',
    mjs: 'JavaScript',
    cjs: 'JavaScript',
    py: 'Python',
    rb: 'Ruby',
    go: 'Go',
    java: 'Java',
    kt: 'Kotlin',
    php: 'PHP',
    cs: 'C#',
    rs: 'Rust',
    sql: 'SQL',
    prisma: 'Prisma schema',
    yml: 'YAML',
    yaml: 'YAML',
    json: 'JSON',
};
function detectLanguage(filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (!ext)
        return undefined;
    return EXTENSION_MAP[ext];
}
exports.ANALYZABLE_EXTENSIONS = new Set(Object.keys(EXTENSION_MAP));
//# sourceMappingURL=language.js.map