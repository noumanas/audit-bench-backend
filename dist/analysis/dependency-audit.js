"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.auditDependencies = auditDependencies;
const child_process_1 = require("child_process");
const promises_1 = require("fs/promises");
const os_1 = require("os");
const path = require("path");
const pLimit = require("p-limit");
async function auditDependencies(files) {
    const [npm, python] = await Promise.all([auditNpmDependencies(files), auditPythonDependencies(files)]);
    return [...npm, ...python].slice(0, 50);
}
async function auditNpmDependencies(files) {
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
const OSV_API = 'https://api.osv.dev/v1';
const REQUIREMENTS_LINE = /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*==\s*([A-Za-z0-9._+!-]+)/;
async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    }
    finally {
        clearTimeout(timer);
    }
}
async function auditPythonDependencies(files) {
    const requirements = files.find((f) => f.path === 'requirements.txt' || f.path.endsWith('/requirements.txt'));
    if (!requirements)
        return [];
    const packages = [];
    for (const rawLine of requirements.content.split('\n')) {
        const line = rawLine.split('#')[0].trim();
        if (!line || line.startsWith('-'))
            continue;
        const match = REQUIREMENTS_LINE.exec(line);
        if (match)
            packages.push({ name: match[1], version: match[2] });
    }
    if (packages.length === 0)
        return [];
    const capped = packages.slice(0, 50);
    let batchResults;
    try {
        const res = await fetchWithTimeout(`${OSV_API}/querybatch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                queries: capped.map((p) => ({ package: { name: p.name, ecosystem: 'PyPI' }, version: p.version })),
            }),
        }, 10_000);
        if (!res.ok)
            return [];
        batchResults = await res.json();
    }
    catch {
        return [];
    }
    const idToPackages = new Map();
    for (let i = 0; i < capped.length; i++) {
        const vulns = batchResults?.results?.[i]?.vulns || [];
        for (const v of vulns) {
            if (!idToPackages.has(v.id))
                idToPackages.set(v.id, new Set());
            idToPackages.get(v.id).add(capped[i].name);
        }
    }
    const ids = [...idToPackages.keys()].slice(0, 40);
    if (ids.length === 0)
        return [];
    const limit = pLimit(5);
    const details = await Promise.all(ids.map((id) => limit(async () => {
        try {
            const res = await fetchWithTimeout(`${OSV_API}/vulns/${id}`, {}, 10_000);
            if (!res.ok)
                return null;
            return await res.json();
        }
        catch {
            return null;
        }
    })));
    const findings = [];
    for (const detail of details) {
        if (!detail)
            continue;
        const packageNames = idToPackages.get(detail.id) ?? new Set();
        const severity = detail.database_specific?.severity?.toLowerCase() || 'unknown';
        for (const pkgName of packageNames) {
            const pinned = capped.find((p) => p.name === pkgName)?.version || '';
            findings.push({
                package: pkgName,
                severity,
                title: detail.summary || `Vulnerable dependency: ${pkgName}`,
                url: `https://osv.dev/vulnerability/${detail.id}`,
                range: pinned,
            });
        }
    }
    return findings.slice(0, 50);
}
//# sourceMappingURL=dependency-audit.js.map