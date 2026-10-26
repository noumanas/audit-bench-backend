import { ScannedFile } from './types';

/**
 * .NET solutions: named by what their project files build, e.g. ".NET
 * (ASP.NET Core, Azure Functions, WinForms)" for a multi-project solution.
 */
function detectDotnet(files: ScannedFile[]): string | undefined {
  const projects = files.filter((f) => /\.(csproj|vbproj|fsproj)$/i.test(f.path));
  const hasSolution = files.some((f) => /\.sln$/i.test(f.path));
  if (!projects.length && !hasSolution) return undefined;
  const kinds = new Set<string>();
  for (const p of projects) {
    if (/Microsoft\.NET\.Sdk\.Web|Microsoft\.AspNetCore/i.test(p.content)) kinds.add('ASP.NET Core');
    if (/Microsoft\.NET\.Sdk\.Functions|Microsoft\.Azure\.Functions/i.test(p.content)) kinds.add('Azure Functions');
    if (/<UseWindowsForms>\s*true|System\.Windows\.Forms/i.test(p.content)) kinds.add('WinForms');
    if (/<UseWPF>\s*true/i.test(p.content)) kinds.add('WPF');
    if (/Microsoft\.NET\.Sdk\.BlazorWebAssembly|Microsoft\.AspNetCore\.Components/i.test(p.content)) kinds.add('Blazor');
    if (/Microsoft\.Maui|<UseMaui>\s*true/i.test(p.content)) kinds.add('.NET MAUI');
  }
  if (files.some((f) => /(^|\/)host\.json$/i.test(f.path)) && files.some((f) => /\.cs$/i.test(f.path))) {
    kinds.add('Azure Functions');
  }
  if (files.some((f) => /\.designer\.cs$/i.test(f.path) && /System\.Windows\.Forms/.test(f.content))) kinds.add('WinForms');
  if (files.some((f) => /(^|\/)Web\.config$/i.test(f.path)) && !kinds.has('ASP.NET Core')) kinds.add('ASP.NET');
  return kinds.size ? `.NET (${[...kinds].join(', ')})` : '.NET';
}

export function detectFramework(files: ScannedFile[]): string | undefined {
  const byPath = new Map(files.map((f) => [f.path, f]));

  const dotnet = detectDotnet(files);
  if (dotnet) return dotnet;

  const packageJson = byPath.get('package.json');
  if (packageJson) {
    let pkg: any = null;
    try {
      pkg = JSON.parse(packageJson.content);
    } catch {
      pkg = null;
    }
    if (pkg) {
      const deps: Record<string, string> = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps['next']) return 'Next.js';
      if (deps['@nestjs/core']) return 'NestJS';
      if (deps['@angular/core']) return 'Angular';
      if (deps['vue']) return 'Vue';
      if (deps['@supabase/supabase-js']) return 'Supabase';
      if (deps['firebase'] || deps['firebase-admin']) return 'Firebase';
      if (deps['express']) return 'Node.js (Express)';
      if (deps['react']) return 'React';
    }
  }

  if (files.some((f) => /(^|\/)deno\.jsonc?$/.test(f.path.replace(/\\/g, '/')))) return 'Deno';
  if (files.some((f) => /(^|\/)supabase\/config\.toml$/.test(f.path.replace(/\\/g, '/')))) return 'Supabase';
  if (files.some((f) => /(^|\/)firebase\.json$/.test(f.path.replace(/\\/g, '/')))) return 'Firebase';
  if (files.some((f) => /(^|\/)go\.mod$/.test(f.path))) return 'Go';
  if (files.some((f) => /(^|\/)Cargo\.toml$/.test(f.path))) return 'Rust';
  if (files.some((f) => /(^|\/)Gemfile$/.test(f.path) && /\brails\b/.test(f.content))) return 'Ruby on Rails';
  if (files.some((f) => /(^|\/)composer\.json$/.test(f.path.replace(/\\/g, '/')))) return 'Laravel';
  if (files.some((f) => /(^|\/)(pom\.xml|build\.gradle)$/.test(f.path.replace(/\\/g, '/')))) return 'Spring Boot';
  if (files.some((f) => /(^|\/)manage\.py$/.test(f.path.replace(/\\/g, '/')))) return 'Django';
  if (files.some((f) => /(^|\/)pyproject\.toml$/.test(f.path.replace(/\\/g, '/')))) return 'Python';
  if (
    files.some(
      (f) =>
        /(^|\/)(requirements\.txt|pyproject\.toml)$/.test(f.path.replace(/\\/g, '/')) &&
        /fastapi/i.test(f.content),
    )
  )
    return 'FastAPI';
  if (files.some((f) => /(^|\/)(requirements\.txt|pyproject\.toml)$/.test(f.path.replace(/\\/g, '/')))) return 'Python';

  return undefined;
}
