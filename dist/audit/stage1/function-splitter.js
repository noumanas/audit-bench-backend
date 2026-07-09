"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitFunctions = splitFunctions;
const ts = require("typescript");
const complexity_1 = require("./complexity");
function scriptKindFor(filename) {
    if (/\.tsx$/i.test(filename))
        return ts.ScriptKind.TSX;
    if (/\.jsx$/i.test(filename))
        return ts.ScriptKind.JSX;
    if (/\.(js|mjs|cjs)$/i.test(filename))
        return ts.ScriptKind.JS;
    return ts.ScriptKind.TS;
}
function nameOf(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name)
        return node.name.text;
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name))
        return node.name.text;
    const parent = node.parent;
    if (parent) {
        if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name))
            return parent.name.text;
        if (ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name))
            return parent.name.text;
        if (ts.isPropertyDeclaration(parent) && ts.isIdentifier(parent.name))
            return parent.name.text;
    }
    return 'anonymous';
}
function splitFunctions(code, filename) {
    let sourceFile;
    try {
        sourceFile = ts.createSourceFile(filename, code, ts.ScriptTarget.Latest, true, scriptKindFor(filename));
    }
    catch {
        return [{ name: '(file)', startLine: 1, endLine: code.split('\n').length, code, complexity: 1, callsInFile: [] }];
    }
    const units = [];
    const isNamedFunctionLike = (node) => {
        if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node))
            return true;
        if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
            const parent = node.parent;
            return Boolean(parent &&
                (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)));
        }
        return false;
    };
    function visit(node) {
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
        const callsInFile = [];
        const findCalls = (n) => {
            if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
                const called = n.expression.text;
                if (declaredNames.has(called) && called !== name)
                    callsInFile.push(called);
            }
            ts.forEachChild(n, findCalls);
        };
        findCalls(node);
        return {
            name,
            startLine: start,
            endLine: end,
            code: fnCode,
            complexity: (0, complexity_1.cyclomaticComplexity)(node),
            callsInFile: [...new Set(callsInFile)],
        };
    });
}
//# sourceMappingURL=function-splitter.js.map