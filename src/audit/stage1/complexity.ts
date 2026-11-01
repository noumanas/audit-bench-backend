import * as ts from 'typescript';

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

/** Standard cyclomatic complexity: 1 + one per decision point in the subtree. */
export function cyclomaticComplexity(root: ts.Node): number {
  let count = 1;

  function visit(node: ts.Node) {
    if (DECISION_KINDS.has(node.kind)) {
      count++;
    } else if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (
        op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      ) {
        count++;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(root);
  return count;
}


// Statements that open a nested block of control flow. Ternaries and
// boolean operators add complexity but not nesting a reader has to track.
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

/**
 * Deepest nesting of control-flow blocks in the subtree. Separates a flat
 * function with many sibling branches (a row mapper normalizing optional
 * fields: high complexity, depth 1) from genuinely tangled logic. An
 * `else if` chain counts as one level, as a reader sees it, and nested
 * functions start their own count.
 */
export function maxNestingDepth(root: ts.Node): number {
  let max = 0;

  function visit(node: ts.Node, depth: number) {
    let d = depth;
    const elseIf = ts.isIfStatement(node) && node.parent && ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
    if (NESTING_KINDS.has(node.kind) && !elseIf) {
      d = depth + 1;
      if (d > max) max = d;
    }
    ts.forEachChild(node, (child) => {
      if (ts.isFunctionLike(child) && child !== root) return;
      visit(child, d);
    });
  }

  visit(root, 0);
  return max;
}
