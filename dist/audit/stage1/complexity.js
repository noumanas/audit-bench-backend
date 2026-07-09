"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cyclomaticComplexity = cyclomaticComplexity;
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
//# sourceMappingURL=complexity.js.map