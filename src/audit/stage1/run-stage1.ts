import { Stage1Result } from './types';
import { splitFunctions } from './function-splitter';
import { runEslint } from './eslint-check';
import { runTypeScriptCheck } from './typescript-check';
import { checkFormatting } from './prettier-check';
import { runSemgrep } from './semgrep-check';
import { selectRiskyFunctions } from './risk-scorer';
import { runPythonCheck } from './python-check';
import { runPatternCheck } from './pattern-check';
import { splitBlockFunctions } from './block-splitter';

const ANALYZABLE_BY_AST = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const PYTHON_FILE = /\.(py|pyi)$/i;

/**
 * Every free, local check that runs before a single token is spent on an
 * LLM. Always runs in full — this is the layer that makes "0 AI credits"
 * audits possible when nothing here is worth escalating.
 */
export async function runStage1(code: string, filename: string): Promise<Stage1Result> {
  const isCode = ANALYZABLE_BY_AST.test(filename);
  const isPython = PYTHON_FILE.test(filename);

  const lint = isCode ? runEslint(code, filename) : [];
  const python = isPython ? runPythonCheck(code, filename) : [];
  const patterns = runPatternCheck(code, filename);
  const tsDiagnostics = runTypeScriptCheck(code, filename);
  const { formatted, skipped: formattingSkipped } = await checkFormatting(code, filename);
  const semgrep = await runSemgrep(code, filename);
  // Other languages are split by text, so C#, Java, Go… files get the same risk triage as JavaScript.
  const functions = isCode ? splitFunctions(code, filename) : splitBlockFunctions(code, filename);
  const riskyFunctions = selectRiskyFunctions(functions, lint, filename);

  const semgrepFlagged = !semgrep.skipped && semgrep.findings.length > 0;
  const pythonFlagged = python.some((p) => p.severity === 'error');
  const patternFlagged = patterns.some((p) => p.severity === 'error');

  return {
    lint,
    python,
    patterns,
    tsDiagnostics,
    formatted,
    formattingSkipped,
    semgrep,
    functions,
    riskyFunctions,
    clean:
      riskyFunctions.length === 0 && tsDiagnostics.length === 0 && !semgrepFlagged && !pythonFlagged && !patternFlagged,
  };
}
