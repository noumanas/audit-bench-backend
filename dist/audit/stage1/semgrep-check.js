"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSemgrep = runSemgrep;
const child_process_1 = require("child_process");
const promises_1 = require("fs/promises");
const os_1 = require("os");
const path = require("path");
let semgrepAvailable = null;
function checkSemgrepInstalled() {
    if (semgrepAvailable !== null)
        return Promise.resolve(semgrepAvailable);
    return new Promise((resolve) => {
        (0, child_process_1.execFile)('semgrep', ['--version'], (err) => {
            semgrepAvailable = !err;
            resolve(semgrepAvailable);
        });
    });
}
async function runSemgrep(code, filename) {
    const installed = await checkSemgrepInstalled();
    if (!installed) {
        return { skipped: true, reason: 'semgrep is not installed on this server (optional — see README)' };
    }
    const dir = await (0, promises_1.mkdtemp)(path.join((0, os_1.tmpdir)(), 'semgrep-'));
    const filePath = path.join(dir, path.basename(filename) || 'snippet.txt');
    try {
        await (0, promises_1.writeFile)(filePath, code, 'utf8');
        const findings = await new Promise((resolve) => {
            (0, child_process_1.execFile)('semgrep', ['--config', 'auto', '--json', '--quiet', '--timeout', '20', filePath], { maxBuffer: 10 * 1024 * 1024 }, (_err, stdout) => {
                try {
                    const parsed = JSON.parse(stdout || '{}');
                    const results = Array.isArray(parsed.results) ? parsed.results : [];
                    resolve(results.slice(0, 20).map((r) => ({
                        pattern: r.check_id || 'semgrep-rule',
                        line: r.start?.line ?? 0,
                        snippet: (r.extra?.lines || '').slice(0, 160),
                    })));
                }
                catch {
                    resolve([]);
                }
            });
        });
        return { skipped: false, findings };
    }
    catch {
        return { skipped: true, reason: 'semgrep run failed' };
    }
    finally {
        await (0, promises_1.rm)(dir, { recursive: true, force: true }).catch(() => { });
    }
}
//# sourceMappingURL=semgrep-check.js.map