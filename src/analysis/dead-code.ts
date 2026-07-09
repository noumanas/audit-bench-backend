import { ScannedFile } from './types';

const ENTRY_PATTERNS = [
  /(^|\/)(index|main|app|server)\.(ts|tsx|js|jsx)$/i,
  /(^|\/)pages\//, // Next.js pages router
  /(^|\/)app\//, // Next.js app router
  /\.(test|spec)\.(ts|tsx|js|jsx)$/i,
  /\.d\.ts$/i,
];

function isEntryLike(filePath: string): boolean {
  return ENTRY_PATTERNS.some((re) => re.test(filePath));
}

export function findDeadCode(files: ScannedFile[], graph: Record<string, string[]>): string[] {
  const imported = new Set<string>();
  for (const targets of Object.values(graph)) {
    for (const t of targets) imported.add(t);
  }

  return Object.keys(graph)
    .filter((filePath) => !imported.has(filePath) && !isEntryLike(filePath))
    .slice(0, 30);
}
