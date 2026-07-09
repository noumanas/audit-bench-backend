const EXTENSION_MAP: Record<string, string> = {
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

export function detectLanguage(filename: string): string | undefined {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  return EXTENSION_MAP[ext];
}

/** File extensions worth sending to the LLM for review. */
export const ANALYZABLE_EXTENSIONS = new Set(Object.keys(EXTENSION_MAP));
