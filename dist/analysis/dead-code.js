"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findDeadCode = findDeadCode;
const ENTRY_PATTERNS = [
    /(^|\/)(index|main|app|server)\.(ts|tsx|js|jsx)$/i,
    /(^|\/)pages\//,
    /(^|\/)app\//,
    /\.(test|spec)\.(ts|tsx|js|jsx)$/i,
    /\.d\.ts$/i,
];
function isEntryLike(filePath) {
    return ENTRY_PATTERNS.some((re) => re.test(filePath));
}
function findDeadCode(files, graph) {
    const imported = new Set();
    for (const targets of Object.values(graph)) {
        for (const t of targets)
            imported.add(t);
    }
    return Object.keys(graph)
        .filter((filePath) => !imported.has(filePath) && !isEntryLike(filePath))
        .slice(0, 30);
}
//# sourceMappingURL=dead-code.js.map