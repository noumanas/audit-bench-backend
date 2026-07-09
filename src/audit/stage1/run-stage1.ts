import { Stage1Result } from './types';
import { splitFunctions } from './function-splitter';
import { runEslint } from './eslint-check';
import { runTypeScriptCheck } from './typescript-check';
import { checkFormatting } from './prettier-check';
import { runSemgrep } from './semgrep-check';
import { selectRiskyFunctions } from './risk-scorer';

const ANALYZABLE_BY_AST = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;

/**
 * Every free, local check that runs before a single token is spent on an
 * LLM. Always runs in full — this is the layer that makes "0 AI credits"
 * audits possible when nothing here is worth escalating.
 */
export async function runStage1(code: string, filename: string): Promise<Stage1Result> {
  const isCode = ANALYZABLE_BY_AST.test(filename);

  const lint = isCode ? runEslint(code, filename) : [];
  const tsDiagnostics = runTypeScriptCheck(code, filename);
  const { formatted, skipped: formattingSkipped } = await checkFormatting(code, filename);
  const semgrep = await runSemgrep(code, filename);
  const functions = isCode ? splitFunctions(code, filename) : [];
  const riskyFunctions = selectRiskyFunctions(functions, lint);

  const semgrepFlagged = !semgrep.skipped && semgrep.findings.length > 0;

  return {
    lint,
    tsDiagnostics,
    formatted,
    formattingSkipped,
    semgrep,
    functions,
    riskyFunctions,
    clean: riskyFunctions.length === 0 && tsDiagnostics.length === 0 && !semgrepFlagged,
  };
}
