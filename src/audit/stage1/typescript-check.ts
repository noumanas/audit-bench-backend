import * as ts from 'typescript';
import { TsDiagnostic } from './types';

/**
 * Isolated-module syntactic diagnostics only — a full type-checked Program
 * needs real module resolution (node_modules, tsconfig paths) that an
 * arbitrary pasted snippet or single scanned file doesn't have, and would
 * mostly just report "cannot find module" noise.
 */
export function runTypeScriptCheck(code: string, filename: string): TsDiagnostic[] {
  const isTs = /\.tsx?$/i.test(filename);
  if (!isTs) return [];

  // Merely having a `jsx` key present — even set to `undefined` — makes the
  // compiler treat it as an invalid explicit value, so it's only included
  // at all for .tsx files.
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    noEmit: true,
  };
  if (filename.endsWith('.tsx')) compilerOptions.jsx = ts.JsxEmit.React;

  const diagnostics: ts.Diagnostic[] = [];
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
