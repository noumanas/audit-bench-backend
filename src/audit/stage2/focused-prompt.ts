import { FunctionRisk, FunctionUnit } from '../stage1/types';

const RESPONSE_SHAPE = `{
  "verdict": "pass" | "needs_work" | "do_not_ship",
  "summary": "2-3 sentence overall assessment of the flagged functions",
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "category": "Security" | "Logic" | "Performance" | "Architecture" | "Maintainability",
      "title": "short title",
      "line": <the real file line number given for that function's snippet, offset by where the issue occurs — or null>,
      "description": "what is wrong and why it matters",
      "rootCause": "the underlying mistake that produced this issue",
      "suggestedFix": "concrete, actionable fix",
      "examplePatch": "a short code snippet showing the fix, or null",
      "confidence": <number between 0 and 1 — how sure you are this is a real, exploitable/impactful issue>
    }
  ]
}`;

function signatureOf(fn: FunctionUnit): string {
  const firstLine = fn.code.split('\n')[0]?.trim() ?? fn.name;
  return firstLine.length > 120 ? firstLine.slice(0, 120) + '…' : firstLine;
}

export interface FocusedPromptOptions {
  filename: string;
  language?: string;
  riskyFunctions: FunctionRisk[];
  allFunctions: FunctionUnit[];
  repoContext?: string;
  focusAreas?: string[];
}

/**
 * Sends only the functions Stage 1 flagged as risky — plus one-line
 * signatures of same-file functions they call, for just enough context to
 * reason about the call — instead of the whole file. This is the context
 * control that keeps Stage 2 cheap: a 500-line file with 2 risky functions
 * might send 40 lines instead of 500.
 */
export function buildFocusedPrompt(opts: FocusedPromptOptions): string {
  const focus =
    opts.focusAreas && opts.focusAreas.length > 0
      ? opts.focusAreas.join('; ')
      : 'security (SQLi, XSS, CSRF, SSRF, auth/JWT, secrets), logic bugs, performance, architecture, maintainability';

  const byName = new Map(opts.allFunctions.map((f) => [f.name, f]));

  const sections = opts.riskyFunctions.map(({ fn, reasons }) => {
    const dependencySignatures = fn.callsInFile
      .map((name) => byName.get(name))
      .filter((f): f is FunctionUnit => Boolean(f))
      .map((f) => `  ${signatureOf(f)}  // lines ${f.startLine}-${f.endLine}`)
      .join('\n');

    return `--- Function \`${fn.name}\` (file lines ${fn.startLine}-${fn.endLine}) ---
Flagged because: ${reasons.join(', ')}
${dependencySignatures ? `Calls, in the same file (signatures only, for context):\n${dependencySignatures}\n` : ''}
\`\`\`
${fn.code}
\`\`\``;
  });

  return `You are a senior engineer auditing code — possibly AI-generated — before it ships to production. You are being shown ONLY the functions a static triage pass flagged as risky, not the whole file, to keep this review cheap. Line numbers given are real file line numbers — use them as-is when citing a finding's line.

Focus areas: ${focus}.
${opts.repoContext ? `\nRepository context:\n${opts.repoContext}\n` : ''}
File: ${opts.filename}${opts.language ? ` (${opts.language})` : ''}

${sections.join('\n\n')}

Return ONLY a JSON object, no markdown fences, no preamble, with this exact shape:
${RESPONSE_SHAPE}

Only report real, specific issues in the functions shown — don't invent problems, and don't comment on code you weren't shown. If none of the flagged functions actually have a real issue on closer inspection, return an empty findings array with verdict "pass".`;
}
