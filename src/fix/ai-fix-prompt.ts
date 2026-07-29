import { z } from 'zod';
import { Finding } from '../common/finding.schema';

export const aiFixResultSchema = z.object({
  // Ordered first deliberately: writing this out before fixedCode makes the
  // model work through root cause → fix strategy → why it actually closes
  // the hole, instead of jumping straight to code. Poor-man's chain of
  // thought that survives JSON-mode/schema validation, since providers that
  // enforce strict JSON output would otherwise give the model nowhere to
  // "think" before committing to an answer.
  reasoning: z.string().min(1),
  fixedCode: z.string().min(1),
  explanation: z.string().min(1),
});

const RESPONSE_SHAPE = `{
  "reasoning": "walk through: what is the root cause, what change actually removes it (not just the symptom at the cited line), and does that change hold up against the scenario the finding describes",
  "fixedCode": "the ENTIRE file content with this finding's fix applied — every other line must be byte-for-byte unchanged",
  "explanation": "1-2 sentence summary of what you changed and why, written for the person reviewing the diff — not a repeat of your reasoning"
}`;

const VERIFICATION_STEP = `Before writing your final answer: state your reasoning first, then ask yourself whether the exact scenario the finding describes can still happen anywhere in your fixed version. If yes, your fix is wrong — revise it until the answer is no.`;

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

Treat "Root cause" as the thing that must actually stop being true — "Suggested fix" is a starting hint, not a literal recipe to copy verbatim. If this same root cause shows up more than once in the file (the same unsafe pattern repeated, or the same missing check needed in another branch), fix every occurrence, not just the line that happened to be cited.

${VERIFICATION_STEP}

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
  return `You are a senior engineer fixing a batch of specific, already-identified problems in a real file. Your job is not to make a plausible attempt — every single finding listed below MUST end up fully and correctly resolved. A fix that only touches the cited line but leaves the underlying problem reachable another way is a failure, not a partial success.

File: ${opts.filename}${opts.language ? ` (${opts.language})` : ''}

Findings to fix — all ${opts.findings.length} must be resolved, none skipped:
${opts.findings.map(findingBlock).join('\n\n')}

Current full file content:
\`\`\`
${opts.code}
\`\`\`

For each finding, treat "Root cause" as the thing that must actually stop being true — "Suggested fix" is a starting hint, not a literal recipe to copy verbatim. If the same root cause appears more than once in the file (e.g. the same unsafe pattern repeated, or the same missing check needed in more than one branch), fix every occurrence, not just the line that happened to be cited. Do not refactor unrelated code, change formatting/style elsewhere, or fix anything that isn't in the list above even if you notice it.

In your "reasoning" field, go finding-by-finding: state the root cause, the change that removes it, and then check — can the exact scenario that finding describes still happen anywhere in your fixed version? If yes for any of them, keep fixing until the answer is no for all of them before you write your final answer.

Return ONLY a JSON object, no markdown fences, no preamble, with this exact shape:
${RESPONSE_SHAPE}

The "fixedCode" field must be the complete file, ready to replace the original as-is — not a diff, not a snippet, not truncated. The "explanation" field should briefly summarize all the fixes applied.`;
}
