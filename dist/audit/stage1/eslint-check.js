"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEslint = runEslint;
const eslint_1 = require("eslint");
const parser_1 = require("@typescript-eslint/parser");
const linter = new eslint_1.Linter();
const RULES = {
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',
    'no-debugger': 'error',
    'no-unreachable': 'warn',
    'no-constant-condition': 'warn',
    'no-cond-assign': 'warn',
    'no-dupe-keys': 'error',
    'no-dupe-args': 'error',
    'no-fallthrough': 'warn',
    'no-self-compare': 'warn',
    'no-empty': 'warn',
    eqeqeq: 'warn',
    'no-var': 'warn',
};
const config = {
    languageOptions: {
        parser: parser_1.default,
        ecmaVersion: 'latest',
        sourceType: 'module',
    },
    rules: RULES,
};
function runEslint(code, filename) {
    try {
        const messages = linter.verify(code, config, { filename });
        return messages
            .filter((m) => m.ruleId)
            .map((m) => ({
            line: m.line,
            ruleId: m.ruleId,
            message: m.message,
            severity: m.severity === 2 ? 'error' : 'warning',
        }));
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=eslint-check.js.map