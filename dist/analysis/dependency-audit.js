"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditDependencies = auditDependencies;
const child_process_1 = require("child_process");
const promises_1 = require("fs/promises");
const os_1 = require("os");
const path = require("path");
async function auditDependencies(files) {
    const packageJson = files.find((f) => f.path === 'package.json');
    const lockfile = files.find((f) => f.path === 'package-lock.json');
    if (!packageJson || !lockfile)
        return [];
    const dir = await (0, promises_1.mkdtemp)(path.join((0, os_1.tmpdir)(), 'npm-audit-'));
    try {
        await (0, promises_1.writeFile)(path.join(dir, 'package.json'), packageJson.content, 'utf8');
        await (0, promises_1.writeFile)(path.join(dir, 'package-lock.json'), lockfile.content, 'utf8');
        const stdout = await new Promise((resolve) => {
            (0, child_process_1.execFile)('npm', ['audit', '--json', '--package-lock-only'], { cwd: dir, timeout: 20_000, maxBuffer: 10 * 1024 * 1024 }, (_err, out) => resolve(out || '{}'));
        });
        const parsed = JSON.parse(stdout);
        const vulnerabilities = parsed.vulnerabilities || {};
        const findings = [];
        for (const [pkgName, info] of Object.entries(vulnerabilities)) {
            const via = Array.isArray(info.via) ? info.via.filter((v) => typeof v === 'object') : [];
            for (const v of via.slice(0, 3)) {
                findings.push({
                    package: pkgName,
                    severity: v.severity || info.severity || 'unknown',
                    title: v.title || `Vulnerable dependency: ${pkgName}`,
                    url: v.url || '',
                    range: v.range || info.range || '',
                });
            }
        }
        return findings.slice(0, 50);
    }
    catch {
        return [];
    }
    finally {
        await (0, promises_1.rm)(dir, { recursive: true, force: true }).catch(() => { });
    }
}
//# sourceMappingURL=dependency-audit.js.map