"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runTypeScriptCheck = runTypeScriptCheck;
const ts = require("typescript");
function runTypeScriptCheck(code, filename) {
    const isTs = /\.tsx?$/i.test(filename);
    if (!isTs)
        return [];
    const compilerOptions = {
        target: ts.ScriptTarget.Latest,
        module: ts.ModuleKind.ESNext,
        noEmit: true,
    };
    if (filename.endsWith('.tsx'))
        compilerOptions.jsx = ts.JsxEmit.React;
    const diagnostics = [];
    ts.transpileModule(code, {
        compilerOptions,
        fileName: filename,
        reportDiagnostics: true,
    }).diagnostics?.forEach((d) => diagnostics.push(d));
    return diagnostics
        .filter((d) => d.category === ts.DiagnosticCategory.Error)
        .map((d) => {
        const line = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
        return { line, message: ts.flattenDiagnosticMessageText(d.messageText, ' ') };
    });
}
//# sourceMappingURL=typescript-check.js.map