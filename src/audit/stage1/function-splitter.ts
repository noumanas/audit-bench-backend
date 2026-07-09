import * as ts from 'typescript';
import { FunctionUnit } from './types';
import { cyclomaticComplexity } from './complexity';

function scriptKindFor(filename: string): ts.ScriptKind {
  if (/\.tsx$/i.test(filename)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(filename)) return ts.ScriptKind.JSX;
  if (/\.(js|mjs|cjs)$/i.test(filename)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function nameOf(node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression): string {
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;

  const parent = node.parent;
  if (parent) {
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
    if (ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text;
  }
  return 'anonymous';
}

/**
 * Splits source into named, top-level-ish function units using the TS AST
 * (works for plain JS too — the parser just skips type syntax). Anonymous
 * inline callbacks (`arr.map(x => ...)`) are intentionally not split out
 * individually — they'd fragment the risk signal without adding much.
 */
export function splitFunctions(code: string, filename: string): FunctionUnit[] {
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, scriptKindFor(filename));
  } catch {
    return [{ name: '(file)', startLine: 1, endLine: code.split('\n').length, code, complexity: 1, callsInFile: [] }];
  }

  const units: { name: string; node: ts.Node }[] = [];

  const isNamedFunctionLike = (node: ts.Node): node is ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression => {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) return true;
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      const parent = node.parent;
      return Boolean(
        parent &&
          (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)),
      );
    }
    return false;
  };

  function visit(node: ts.Node) {
    if (isNamedFunctionLike(node) && (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ? node.body : true)) {
      units.push({ name: nameOf(node), node });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  if (units.length === 0) {
    return [{ name: '(file)', startLine: 1, endLine: code.split('\n').length, code, complexity: 1, callsInFile: [] }];
  }

  const declaredNames = new Set(units.map((u) => u.name));

  return units.map(({ name, node }) => {
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    const fnCode = sourceFile.text.slice(node.getStart(sourceFile), node.getEnd());

    const callsInFile: string[] = [];
    const findCalls = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const called = n.expression.text;
        if (declaredNames.has(called) && called !== name) callsInFile.push(called);
      }
      ts.forEachChild(n, findCalls);
    };
    findCalls(node);

    return {
      name,
      startLine: start,
      endLine: end,
      code: fnCode,
      complexity: cyclomaticComplexity(node),
      callsInFile: [...new Set(callsInFile)],
    };
  });
}
