"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectFramework = detectFramework;
function detectDotnet(files) {
    const projects = files.filter((f) => /\.(csproj|vbproj|fsproj)$/i.test(f.path));
    const hasSolution = files.some((f) => /\.sln$/i.test(f.path));
    if (!projects.length && !hasSolution)
        return undefined;
    const kinds = new Set();
    for (const p of projects) {
        if (/Microsoft\.NET\.Sdk\.Web|Microsoft\.AspNetCore/i.test(p.content))
            kinds.add('ASP.NET Core');
        if (/Microsoft\.NET\.Sdk\.Functions|Microsoft\.Azure\.Functions/i.test(p.content))
            kinds.add('Azure Functions');
        if (/<UseWindowsForms>\s*true|System\.Windows\.Forms/i.test(p.content))
            kinds.add('WinForms');
        if (/<UseWPF>\s*true/i.test(p.content))
            kinds.add('WPF');
        if (/Microsoft\.NET\.Sdk\.BlazorWebAssembly|Microsoft\.AspNetCore\.Components/i.test(p.content))
            kinds.add('Blazor');
        if (/Microsoft\.Maui|<UseMaui>\s*true/i.test(p.content))
            kinds.add('.NET MAUI');
    }
    if (files.some((f) => /(^|\/)host\.json$/i.test(f.path)) && files.some((f) => /\.cs$/i.test(f.path))) {
        kinds.add('Azure Functions');
    }
    if (files.some((f) => /\.designer\.cs$/i.test(f.path) && /System\.Windows\.Forms/.test(f.content)))
        kinds.add('WinForms');
    if (files.some((f) => /(^|\/)Web\.config$/i.test(f.path)) && !kinds.has('ASP.NET Core'))
        kinds.add('ASP.NET');
    return kinds.size ? `.NET (${[...kinds].join(', ')})` : '.NET';
}
function jsFramework(content) {
    let pkg = null;
    try {
        pkg = JSON.parse(content);
    }
    catch {
        return undefined;
    }
    if (!pkg || typeof pkg !== 'object')
        return undefined;
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
    return undefined;
}
function detectFramework(files) {
    const dotnet = detectDotnet(files);
    if (dotnet)
        return dotnet;
    const entries = files.map((f) => ({ path: f.path.replace(/\\/g, '/'), content: f.content }));
    const has = (re, contentRe) => entries.some((e) => re.test(e.path) && (!contentRe || contentRe.test(e.content)));
    const packageJsons = entries
        .filter((e) => /(^|\/)package\.json$/.test(e.path))
        .sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    for (const pkg of packageJsons) {
        const framework = jsFramework(pkg.content);
        if (framework)
            return framework;
    }
    if (has(/(^|\/)deno\.jsonc?$/))
        return 'Deno';
    if (has(/(^|\/)supabase\/config\.toml$/))
        return 'Supabase';
    if (has(/(^|\/)firebase\.json$/))
        return 'Firebase';
    if (has(/(^|\/)go\.mod$/))
        return 'Go';
    if (has(/(^|\/)Cargo\.toml$/))
        return 'Rust';
    if (has(/(^|\/)Gemfile$/, /\brails\b/))
        return 'Ruby on Rails';
    if (has(/(^|\/)composer\.json$/))
        return 'Laravel';
    if (has(/(^|\/)(pom\.xml|build\.gradle)$/))
        return 'Spring Boot';
    if (has(/(^|\/)manage\.py$/))
        return 'Django';
    if (has(/(^|\/)(requirements\.txt|pyproject\.toml)$/, /fastapi/i))
        return 'FastAPI';
    if (has(/(^|\/)(requirements\.txt|pyproject\.toml)$/))
        return 'Python';
    return undefined;
}
//# sourceMappingURL=framework-detector.js.map