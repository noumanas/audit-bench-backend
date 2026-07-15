"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectFramework = detectFramework;
function detectFramework(files) {
    const byPath = new Map(files.map((f) => [f.path, f]));
    const packageJson = byPath.get('package.json');
    if (packageJson) {
        let pkg = null;
        try {
            pkg = JSON.parse(packageJson.content);
        }
        catch {
            pkg = null;
        }
        if (pkg) {
            const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
            if (deps['next'])
                return 'Next.js';
            if (deps['@nestjs/core'])
                return 'NestJS';
            if (deps['@angular/core'])
                return 'Angular';
            if (deps['vue'])
                return 'Vue';
            if (deps['@supabase/supabase-js'])
                return 'Supabase';
            if (deps['firebase'] || deps['firebase-admin'])
                return 'Firebase';
            if (deps['express'])
                return 'Node.js (Express)';
            if (deps['react'])
                return 'React';
        }
    }
    if (files.some((f) => /(^|\/)deno\.jsonc?$/.test(f.path.replace(/\\/g, '/'))))
        return 'Deno';
    if (files.some((f) => /(^|\/)supabase\/config\.toml$/.test(f.path.replace(/\\/g, '/'))))
        return 'Supabase';
    if (files.some((f) => /(^|\/)firebase\.json$/.test(f.path.replace(/\\/g, '/'))))
        return 'Firebase';
    if (files.some((f) => /(^|\/)composer\.json$/.test(f.path.replace(/\\/g, '/'))))
        return 'Laravel';
    if (files.some((f) => /(^|\/)(pom\.xml|build\.gradle)$/.test(f.path.replace(/\\/g, '/'))))
        return 'Spring Boot';
    if (files.some((f) => /(^|\/)manage\.py$/.test(f.path.replace(/\\/g, '/'))))
        return 'Django';
    if (files.some((f) => /(^|\/)requirements\.txt$/.test(f.path.replace(/\\/g, '/')) &&
        /fastapi/i.test(f.content)))
        return 'FastAPI';
    if (files.some((f) => /(^|\/)requirements\.txt$/.test(f.path.replace(/\\/g, '/'))))
        return 'Python';
    return undefined;
}
//# sourceMappingURL=framework-detector.js.map