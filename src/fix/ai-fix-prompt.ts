import { z } from 'zod';
import { Finding } from '../common/finding.schema';

export const aiFixResultSchema = z.object({
  fixedCode: z.string().min(1),
  explanation: z.string().min(1),
});

const RESPONSE_SHAPE = `{
  "fixedCode": "the ENTIRE file content with this finding's fix applied — every other line must be byte-for-byte unchanged",
  "explanation": "1-2 sentence summary of what you changed and why"
}`;

export interface AiFixPromptOptions {
  filename: string;
  language?: string;
  code: string;
  finding: Finding;
}

/**
 * Unlike the review prompts (focused-prompt.ts), this one gets the WHOLE
 * file — the model has to return the whole thing back, so partial context
 * would risk it hallucinating the surrounding code instead of preserving it.
 */
export function buildAiFixPrompt(opts: AiFixPromptOptions): string {
  const { finding } = opts;

  return `You are a senior engineer applying ONE specific, already-identified fix to a real file. Apply ONLY this finding's fix — do not refactor unrelated code, change formatting/style elsewhere, rename things, or fix other issues you might also notice.

File: ${opts.filename}${opts.language ? ` (${opts.language})` : ''}

Finding to fix:
- Title: ${finding.title}
- Severity: ${finding.severity} (${finding.category})
${finding.line != null ? `- Reported at line: ${finding.line}\n` : ''}- Description: ${finding.description}
- Root cause: ${finding.rootCause}
- Suggested fix: ${finding.suggestedFix}
${finding.examplePatch ? `- Example patch:\n${finding.examplePatch}\n` : ''}
Current full file content:
\`\`\`
${opts.code}
\`\`\`

Return ONLY a JSON object, no markdown fences, no preamble, with this exact shape:
${RESPONSE_SHAPE}

The "fixedCode" field must be the complete file, ready to replace the original as-is — not a diff, not a snippet, not truncated.`;
}

export interface AiFixAllPromptOptions {
  filename: string;
  language?: string;
  code: string;
  findings: Finding[];
}

function findingBlock(finding: Finding, index: number): string {
  return `${index + 1}. ${finding.title} — ${finding.severity} (${finding.category})${
    finding.line != null ? ` [reported at line ${finding.line}]` : ''
  }
   Description: ${finding.description}
   Root cause: ${finding.rootCause}
   Suggested fix: ${finding.suggestedFix}${finding.examplePatch ? `\n   Example patch:\n${finding.examplePatch}` : ''}`;
}

/**
 * Same contract as buildAiFixPrompt (whole file in, whole file out) but for
 * every finding in the file at once — one LLM call instead of one per
 * finding, so "fix everything, then recheck" is cheap enough to trigger
 * automatically instead of requiring N clicks.
 */
export function buildAiFixAllPrompt(opts: AiFixAllPromptOptions): string {
  return `You are a senior engineer applying a batch of specific, already-identified fixes to a real file. Apply ALL of the findings below — don't skip any, don't refactor unrelated code, don't change formatting/style elsewhere, and don't fix issues that aren't listed even if you notice them.

File: ${opts.filename}${opts.language ? ` (${opts.language})` : ''}

Findings to fix (${opts.findings.length} total):
${opts.findings.map(findingBlock).join('\n\n')}

Current full file content:
\`\`\`
${opts.code}
\`\`\`

Return ONLY a JSON object, no markdown fences, no preamble, with this exact shape:
${RESPONSE_SHAPE}

The "fixedCode" field must be the complete file, ready to replace the original as-is — not a diff, not a snippet, not truncated. The "explanation" field should briefly summarize all the fixes applied.`;
}
