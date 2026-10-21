"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withoutSourceCode = withoutSourceCode;
function withoutSourceCode(stage1) {
    const strip = (fn) => ({ ...fn, code: '' });
    return {
        ...stage1,
        functions: stage1.functions.map(strip),
        riskyFunctions: stage1.riskyFunctions.map((r) => ({ ...r, fn: strip(r.fn) })),
    };
}
//# sourceMappingURL=types.js.map