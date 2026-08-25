import { z } from 'zod';
import { ScannedFile } from '../analysis/types';

export const architectureAssessmentSchema = z.object({
  // 0 = ad-hoc, every file does its own thing; 100 = highly consistent conventions throughout.
  consistencyScore: z.number().min(0).max(100),
  riskLevel: z.enum(['high', 'medium', 'low']),
  summary: z.string().min(1),
  inconsistencies: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        files: z.array(z.string()).max(10),
      }),
    )
    .max(8),
});

export type ArchitectureAssessment = z.infer<typeof architectureAssessmentSchema>;

const MAX_SAMPLE_FILES = 15;
const MAX_CHARS_PER_FILE = 1500;
const MIN_FILES_FOR_ASSESSMENT = 3;

/** Same source-directory priority as RepositoryService.selectFilesToAnalyze, kept local so this module has no import-order dependency on it. */
function priority(p: string): number {
  return /(^|\/)(src|app|pages|api|lib)\//.test(p) ? 0 : 1;
}

/**
 * Builds a prompt sampling across the codebase for one repo-level LLM
 * judgment call — a single call, not one per file, since architectural
 * consistency is a cross-file property no per-file check can see. Returns
 * null when there's too little to compare (an empty or near-empty
 * codebase), so callers can skip the LLM call entirely rather than pay for
 * a meaningless answer.
 */
export function buildArchitecturePrompt(files: ScannedFile[]): string | null {
  const candidates = [...files].sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path));
  if (candidates.length < MIN_FILES_FOR_ASSESSMENT) return null;

  const sample = candidates.slice(0, MAX_SAMPLE_FILES);
  const sections = sample.map((f) => {
    const truncated = f.content.length > MAX_CHARS_PER_FILE;
    const body = f.content.slice(0, MAX_CHARS_PER_FILE);
    return `--- ${f.path} ---\n\`\`\`\n${body}${truncated ? '\n... (truncated)' : ''}\n\`\`\``;
  });

  return `You are a senior engineer assessing architectural consistency across a codebase for a technical due-diligence review — the audience is an investment/deal team, not just other engineers.

You are shown ${sample.length} representative file(s) out of ${files.length} total in this scan (prioritized toward core source directories). Judge only what these samples actually show — do not assume anything about files you were not shown.

Look for:
- Mixed or inconsistent state-management approaches (e.g. multiple competing patterns for the same kind of problem)
- Inconsistent error-handling, data-access, or API-response conventions across similar files
- Signs of ad-hoc or one-off development (copy-pasted boilerplate that drifted, inconsistent naming/structure between files that should look alike)
- Whether the codebase reads as one coherent system or as several different styles stitched together

${sections.join('\n\n')}

Return ONLY a JSON object, no markdown fences, no preamble, with this exact shape:
{
  "consistencyScore": <integer 0-100, where 0 is completely ad-hoc/inconsistent and 100 is highly consistent conventions throughout>,
  "riskLevel": "high" | "medium" | "low",
  "summary": "2-3 sentence, business-readable assessment — plain language, no unexplained jargon, written for someone deciding whether to invest in or acquire this codebase",
  "inconsistencies": [
    {
      "title": "short, specific label for one inconsistency",
      "description": "what's inconsistent and why it matters for maintainability/cost, in plain language",
      "files": ["exact paths from the samples above that show this"]
    }
  ]
}

Only report inconsistencies you can actually point to in the samples shown — cite real file paths from above, never invented ones. If the samples look consistent, return an empty "inconsistencies" array and a high consistencyScore rather than inventing problems.`;
}
