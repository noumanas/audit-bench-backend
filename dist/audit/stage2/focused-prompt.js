"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFocusedPrompt = buildFocusedPrompt;
const RESPONSE_SHAPE = `{
  "verdict": "pass" | "needs_work" | "do_not_ship",
  "summary": "2-3 sentence overall assessment of the flagged functions, in plain language",
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "category": "Security" | "Logic" | "Performance" | "Architecture" | "Maintainability",
      "title": "a short, plain-language summary of the actual problem — no unexplained jargon or acronyms (avoid things like 'SSRF', 'prototype pollution', 'anti-pattern', 'race condition'); say what happens in everyday words, e.g. 'The server can be tricked into fetching internal URLs' instead of 'SSRF vulnerability'",
      "line": <the real file line number given for that function's snippet, offset by where the issue occurs — or null>,
      "description": "what is wrong and why it matters, written so a junior developer or non-technical reader can follow it — if you use a technical term, explain what it means in the same sentence",
      "rootCause": "the underlying mistake that produced this issue, in plain language",
      "suggestedFix": "concrete, actionable fix, described in plain language",
      "examplePatch": "a short code snippet showing the fix, or null",
      "confidence": <number between 0 and 1 — how sure you are this is a real, exploitable/impactful issue>
    }
  ]
}`;
function signatureOf(fn) {
    const firstLine = fn.code.split('\n')[0]?.trim() ?? fn.name;
    return firstLine.length > 120 ? firstLine.slice(0, 120) + '…' : firstLine;
}
function buildFocusedPrompt(opts) {
    const focus = opts.focusAreas && opts.focusAreas.length > 0
        ? opts.focusAreas.join('; ')
        : 'security (SQLi, XSS, CSRF, SSRF, auth/JWT, secrets), logic bugs, performance, architecture, maintainability';
    const byName = new Map(opts.allFunctions.map((f) => [f.name, f]));
    const sections = opts.riskyFunctions.map(({ fn, reasons }) => {
        const dependencySignatures = fn.callsInFile
            .map((name) => byName.get(name))
            .filter((f) => Boolean(f))
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

Only report real, specific issues in the functions shown — don't invent problems, and don't comment on code you weren't shown. If none of the flagged functions actually have a real issue on closer inspection, return an empty findings array with verdict "pass".

Write every finding in plain, simple language — this is read by developers at every experience level, not just security specialists. Avoid unexplained acronyms and jargon (SSRF, CSRF, XSS, prototype pollution, anti-pattern, race condition, etc.); describe what actually happens and why it's a problem in everyday words instead of just naming the category of bug. Stay technically precise — just say it plainly.`;
}
//# sourceMappingURL=focused-prompt.js.map