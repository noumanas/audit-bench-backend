"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cyclomaticComplexity = cyclomaticComplexity;
exports.maxNestingDepth = maxNestingDepth;
const ts = require("typescript");
const DECISION_KINDS = new Set([
    ts.SyntaxKind.IfStatement,
    ts.SyntaxKind.ForStatement,
    ts.SyntaxKind.ForInStatement,
    ts.SyntaxKind.ForOfStatement,
    ts.SyntaxKind.WhileStatement,
    ts.SyntaxKind.DoStatement,
    ts.SyntaxKind.CaseClause,
    ts.SyntaxKind.CatchClause,
    ts.SyntaxKind.ConditionalExpression,
]);
function cyclomaticComplexity(root) {
    let count = 1;
    function visit(node) {
        if (DECISION_KINDS.has(node.kind)) {
            count++;
        }
        else if (ts.isBinaryExpression(node)) {
            const op = node.operatorToken.kind;
            if (op === ts.SyntaxKind.AmpersandAmpersandToken ||
                op === ts.SyntaxKind.BarBarToken ||
                op === ts.SyntaxKind.QuestionQuestionToken) {
                count++;
            }
        }
        ts.forEachChild(node, visit);
    }
    visit(root);
    return count;
}
const NESTING_KINDS = new Set([
    ts.SyntaxKind.IfStatement,
    ts.SyntaxKind.ForStatement,
    ts.SyntaxKind.ForInStatement,
    ts.SyntaxKind.ForOfStatement,
    ts.SyntaxKind.WhileStatement,
    ts.SyntaxKind.DoStatement,
    ts.SyntaxKind.SwitchStatement,
    ts.SyntaxKind.TryStatement,
]);
function maxNestingDepth(root) {
    let max = 0;
    function visit(node, depth) {
        let d = depth;
        const elseIf = ts.isIfStatement(node) && node.parent && ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
        if (NESTING_KINDS.has(node.kind) && !elseIf) {
            d = depth + 1;
            if (d > max)
                max = d;
        }
        ts.forEachChild(node, (child) => {
            if (ts.isFunctionLike(child) && child !== root)
                return;
            visit(child, d);
        });
    }
    visit(root, 0);
    return max;
}
//# sourceMappingURL=complexity.js.map