"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findDuplicates = findDuplicates;
const crypto_1 = require("crypto");
const CHUNK_LINES = 8;
const MIN_NON_BLANK_LINES = 5;
function normalize(line) {
    return line.trim().replace(/\s+/g, ' ');
}
function findDuplicates(files) {
    const buckets = new Map();
    for (const file of files) {
        const lines = file.content.split('\n');
        for (let start = 0; start + CHUNK_LINES <= lines.length; start += CHUNK_LINES) {
            const chunk = lines.slice(start, start + CHUNK_LINES);
            const normalized = chunk.map(normalize);
            const nonBlank = normalized.filter((l) => l.length > 0);
            if (nonBlank.length < MIN_NON_BLANK_LINES)
                continue;
            const hash = (0, crypto_1.createHash)('sha1').update(normalized.join('\n')).digest('hex');
            const entry = { path: file.path, startLine: start + 1, endLine: start + CHUNK_LINES };
            const bucket = buckets.get(hash);
            if (bucket)
                bucket.push(entry);
            else
                buckets.set(hash, [entry]);
        }
    }
    const groups = [];
    for (const occurrences of buckets.values()) {
        if (occurrences.length < 2)
            continue;
        groups.push({ linesOfCode: CHUNK_LINES, occurrences });
    }
    return groups
        .sort((a, b) => b.occurrences.length - a.occurrences.length)
        .slice(0, 10);
}
//# sourceMappingURL=duplicate-code.js.map