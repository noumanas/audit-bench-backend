"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZERO_USAGE = void 0;
exports.addUsage = addUsage;
exports.ZERO_USAGE = { inputTokens: 0, outputTokens: 0 };
function addUsage(a, b) {
    return { inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens };
}
//# sourceMappingURL=types.js.map