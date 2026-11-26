// Calls, optional calls and tagged templates of a scoped name → `(0, __scope.f)…`, and dynamic `import()`.
import ts from "typescript";

import { isReferencePosition } from "./references.js";
import type { Rewrite } from "./rewrite.js";
import { reference } from "./rewrite.js";

function isScopedCallee(expression: ts.Expression, rewrite: Rewrite): expression is ts.Identifier {
  return (
    ts.isIdentifier(expression) &&
    isReferencePosition(expression) &&
    rewrite.classify(expression) !== "local"
  );
}

/** `(0, __scope.f)`: the call sees `this` as `undefined`, not the scope. */
function indirect(callee: ts.Identifier, rewrite: Rewrite): ts.Expression {
  const { factory } = rewrite;
  const zero = factory.createNumericLiteral("0");
  const comma = factory.createCommaListExpression([zero, reference(rewrite, callee, "read")]);
  return ts.setSourceMapRange(factory.createParenthesizedExpression(comma), callee);
}

/** `import("p")` anywhere → `__scope.__import("p")`; a literal specifier is recorded in the analysis. */
function dynamicImport(
  node: ts.CallExpression,
  rewrite: Rewrite,
  args: ts.NodeArray<ts.Expression>,
) {
  const [specifier] = node.arguments;
  if (specifier && ts.isStringLiteralLike(specifier)) rewrite.recorder.import(specifier.text);
  const load = rewrite.scoped("__import", node.expression);
  return rewrite.factory.updateCallExpression(node, load, node.typeArguments, args);
}

/** The call rules; `undefined` when the call needs no rule beyond visiting its children. */
export function visitCall(
  node: ts.CallExpression,
  rewrite: Rewrite,
  visitor: ts.Visitor,
): ts.Node | undefined {
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return dynamicImport(node, rewrite, ts.visitNodes(node.arguments, visitor, ts.isExpression));
  }
  if (!isScopedCallee(node.expression, rewrite)) return undefined;
  // The callee is noted before the arguments so the analysis keeps source order.
  const callee = indirect(node.expression, rewrite);
  const args = ts.visitNodes(node.arguments, visitor, ts.isExpression);
  const { factory } = rewrite;
  return ts.isCallChain(node)
    ? factory.updateCallChain(node, callee, node.questionDotToken, node.typeArguments, args)
    : factory.updateCallExpression(node, callee, node.typeArguments, args);
}

/** `` f`x` `` with a scoped tag → `` (0, __scope.f)`x` ``. */
export function visitTaggedTemplate(
  node: ts.TaggedTemplateExpression,
  rewrite: Rewrite,
  visitor: ts.Visitor,
): ts.Node | undefined {
  if (!isScopedCallee(node.tag, rewrite)) return undefined;
  const template = ts.visitNode(node.template, visitor, ts.isTemplateLiteral) ?? node.template;
  const tag = indirect(node.tag, rewrite);
  return rewrite.factory.updateTaggedTemplateExpression(node, tag, node.typeArguments, template);
}
