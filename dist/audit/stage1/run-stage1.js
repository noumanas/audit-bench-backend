"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runStage1 = runStage1;
const function_splitter_1 = require("./function-splitter");
const eslint_check_1 = require("./eslint-check");
const typescript_check_1 = require("./typescript-check");
const prettier_check_1 = require("./prettier-check");
const semgrep_check_1 = require("./semgrep-check");
const risk_scorer_1 = require("./risk-scorer");
const ANALYZABLE_BY_AST = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
async function runStage1(code, filename) {
    const isCode = ANALYZABLE_BY_AST.test(filename);
    const lint = isCode ? (0, eslint_check_1.runEslint)(code, filename) : [];
    const tsDiagnostics = (0, typescript_check_1.runTypeScriptCheck)(code, filename);
    const { formatted, skipped: formattingSkipped } = await (0, prettier_check_1.checkFormatting)(code, filename);
    const semgrep = await (0, semgrep_check_1.runSemgrep)(code, filename);
    const functions = isCode ? (0, function_splitter_1.splitFunctions)(code, filename) : [];
    const riskyFunctions = (0, risk_scorer_1.selectRiskyFunctions)(functions, lint);
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
//# sourceMappingURL=run-stage1.js.map