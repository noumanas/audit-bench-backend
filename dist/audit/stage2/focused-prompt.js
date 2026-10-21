"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFocusedPrompt = buildFocusedPrompt;
exports.buildDiffPrompt = buildDiffPrompt;
const RESPONSE_SHAPE = `{
  "verdict": "pass" | "needs_work" | "do_not_ship",
  "summary": "2-3 sentence overall assessment of the flagged functions, in plain language",
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "category": "Security" | "Logic" | "Performance" | "Architecture" | "Maintainability" | "Testing",
      "title": "a short, plain-language summary of the actual problem — no unexplained jargon or acronyms (avoid things like 'SSRF', 'prototype pollution', 'anti-pattern', 'race condition'); say what happens in everyday words, e.g. 'The server can be tricked into fetching internal URLs' instead of 'SSRF vulnerability'",
      "line": <the real file line number given for that function's snippet, offset by where the issue occurs — or null>,
      "endLine": <the last line of the problem code when it spans several lines (same numbering as line), or null for a single line>,
      "description": "what is wrong and why it matters, written so a junior developer or non-technical reader can follow it — if you use a technical term, explain what it means in the same sentence",
      "rootCause": "the underlying mistake that produced this issue, in plain language",
      "suggestedFix": "concrete, actionable fix, described in plain language",
      "examplePatch": "a short code snippet showing the fix, or null",
      "replacement": "only when the fix is confined to lines line..endLine: the exact new code that should replace exactly those lines, with the file's indentation and nothing else (no line numbers, no markers, no explanation); otherwise null",
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
        : 'security (SQLi, XSS, CSRF, SSRF, auth/JWT, secrets), logic bugs, performance, architecture, maintainability, test coverage';
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
${opts.repoContext ? `\nRepository context:\n${opts.repoContext}\n` : ''}${opts.teamRules ? `\n${opts.teamRules}\n` : ''}
File: ${opts.filename}${opts.language ? ` (${opts.language})` : ''}

${sections.join('\n\n')}

Return ONLY a JSON object, no markdown fences, no preamble, with this exact shape:
${RESPONSE_SHAPE}

Only report real, specific issues in the functions shown — don't invent problems, and don't comment on code you weren't shown. If none of the flagged functions actually have a real issue on closer inspection, return an empty findings array with verdict "pass".

For "Testing" findings: you are not shown this file's test suite, so never assert that a test doesn't exist. Instead, flag specific untested-looking risk — a money/auth-critical branch, an edge case (empty input, concurrent calls, a boundary value) that this function's own logic suggests could break it — and phrase it as a recommendation to verify or add coverage, not a claim about what's missing.

Write every finding in plain, simple language — this is read by developers at every experience level, not just security specialists. Avoid unexplained acronyms and jargon (SSRF, CSRF, XSS, prototype pollution, anti-pattern, race condition, etc.); describe what actually happens and why it's a problem in everyday words instead of just naming the category of bug. Stay technically precise — just say it plainly.`;
}
const DIFF_CONTEXT_LINES = 8;
const MAX_DIFF_PROMPT_LINES = 600;
function buildDiffPrompt(opts) {
    const focus = opts.focusAreas && opts.focusAreas.length > 0
        ? opts.focusAreas.join('; ')
        : 'security, logic bugs and edge cases, performance, error handling, architecture, maintainability, test coverage';
    const lines = opts.code.split('\n');
    const width = String(lines.length).length;
    const windows = [];
    for (const r of [...opts.changedRanges].sort((a, b) => a.start - b.start)) {
        const from = Math.max(1, r.start - DIFF_CONTEXT_LINES);
        const to = Math.min(lines.length, r.end + DIFF_CONTEXT_LINES);
        const last = windows[windows.length - 1];
        if (last && from <= last.to + 1)
            last.to = Math.max(last.to, to);
        else
            windows.push({ from, to });
    }
    const inChange = (n) => opts.changedRanges.some((r) => n >= r.start && n <= r.end);
    let budget = MAX_DIFF_PROMPT_LINES;
    const sections = [];
    for (const w of windows) {
        if (budget <= 0)
            break;
        const to = Math.min(w.to, w.from + budget - 1);
        budget -= to - w.from + 1;
        const body = lines
            .slice(w.from - 1, to)
            .map((l, i) => `${inChange(w.from + i) ? '>' : ' '} ${String(w.from + i).padStart(width)} | ${l}`)
            .join('\n');
        sections.push(`--- Lines ${w.from}-${to} ---\n\`\`\`\n${body}\n\`\`\``);
    }
    const truncated = budget <= 0 ? "\n(The rest of this file's changes were cut to keep the review small.)\n" : '';
    return `You are a senior engineer reviewing a pull request before it merges. You are shown the changed regions of one file. Lines marked ">" are in the changed hunks (they include a few unchanged lines GitHub shows for context); unmarked lines are extra context. Each line shows its real line number in the new file — use those numbers as-is for "line" and "endLine".

Focus areas: ${focus}.
${opts.repoContext ? `\nRepository context:\n${opts.repoContext}\n` : ''}${opts.teamRules ? `\n${opts.teamRules}\n` : ''}
File: ${opts.filename}${opts.language ? ` (${opts.language})` : ''}

${sections.join('\n\n')}
${truncated}${opts.relatedContext ? `\n${opts.relatedContext}\n\nIf the change alters behaviour, a signature or a return value these callers rely on, report it on the changed line and name the affected caller.\n` : ''}
Return ONLY a JSON object, no markdown fences, no preamble, with this exact shape:
${RESPONSE_SHAPE}

Comment only on the changed (">") lines, and only on real, specific problems a careful reviewer would raise: bugs, missed edge cases, security issues, broken error handling, performance traps, or changes that clearly need a test. Don't comment on style or formatting, don't restate what the code does, and don't invent problems. If the change looks correct, return an empty findings array with verdict "pass". Point "line" (and "endLine" for a multi-line problem) at the exact changed lines.

For "Testing" findings: you are not shown the test suite, so never assert that a test doesn't exist; recommend verifying or adding coverage for a specific risky case instead.

Write in plain, simple language for developers at every level. Avoid unexplained acronyms and jargon; say what actually happens and why it matters. Stay technically precise.`;
}
//# sourceMappingURL=focused-prompt.js.map