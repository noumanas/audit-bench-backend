"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkFormatting = checkFormatting;
const prettier = require("prettier");
async function checkFormatting(code, filename) {
    try {
        const output = await prettier.format(code, { filepath: filename });
        return { formatted: output.trim() === code.trim(), skipped: false };
    }
    catch {
        return { formatted: true, skipped: true };
    }
}
//# sourceMappingURL=prettier-check.js.map