// The rules that apply at any depth of the cell (04 §3.2 rules 9 to 12 and 14, dynamic import, nested `var`).
import { ReservedName } from "@jsnb/core";
import ts from "typescript";

import { visitCall, visitTaggedTemplate } from "./calls.js";
import { isTopLevelThis, isTopLevelVarList } from "./containers.js";
import { isNamingAssignment, keepName } from "./named.js";
import {
  accessOf,
  isAssignmentPattern,
  isPropertyKey,
  isReferencePosition,
  isTypeLevel,
} from "./references.js";
import type { Rewrite } from "./rewrite.js";
import { reference } from "./rewrite.js";
import type { VariableRules, Visit } from "./variables.js";
import { createVariableRules } from "./variables.js";

type Tools = {
  readonly rewrite: Rewrite;
  readonly visitor: ts.Visitor;
  readonly visit: Visit;
  readonly variables: VariableRules;
};

/** Rule 9 and rule 16: a scoped reference becomes `__scope.x`; `__scope` itself may not appear in a cell. */
function visitIdentifier(id: ts.Identifier, { rewrite }: Tools): ts.Node {
  if (id.text === "__scope" && !isPropertyKey(id)) {
    throw new ReservedName({ name: id.text, ...rewrite.at(id) });
  }
  if (!isReferencePosition(id)) return id;
  const kind = rewrite.classify(id);
  return kind === "local" ? id : reference(rewrite, id, accessOf(id), kind);
}

/** Rule 11: `{ x }` → `{ x: __scope.x }`; as an assignment target it is a write and keeps its default. */
function visitShorthand(node: ts.ShorthandPropertyAssignment, tools: Tools): ts.Node {
  const { rewrite, visit, visitor } = tools;
  const { factory, context } = rewrite;
  if (rewrite.classify(node.name) === "local") return ts.visitEachChild(node, visitor, context);
  const isTarget =
    node.objectAssignmentInitializer !== undefined || isAssignmentPattern(node.parent);
  let value: ts.Expression = reference(rewrite, node.name, isTarget ? "write" : "read");
  const initializer = node.objectAssignmentInitializer;
  if (initializer) {
    const named = keepName(factory, node.name.text, initializer, visit.expression(initializer));
    value = factory.createAssignment(value, named);
  }
  return ts.setSourceMapRange(factory.createPropertyAssignment(node.name, value), node);
}

/** Rule 12: `typeof x` (scoped) → `typeof __scope.$peek("x")`, which never throws for an unknown name. */
function visitTypeOf(node: ts.TypeOfExpression, { rewrite }: Tools): ts.Node | undefined {
  const { expression } = node;
  if (!ts.isIdentifier(expression) || rewrite.classify(expression) === "local") return undefined;
  reference(rewrite, expression, "read");
  const name = rewrite.factory.createStringLiteral(expression.text);
  const peek = rewrite.plumbing("$peek", [name], expression);
  return rewrite.factory.updateTypeOfExpression(node, peek);
}

/** `f = () => 1` (also `&&=`, `||=`, `??=` and a destructuring default `[f = () => 1] = a`) names the arrow "f"; the
 * rewritten `__scope.f = …` keeps that name (named.ts). A local `f` is the emitter's and keeps it already. */
function visitNamingAssignment(node: ts.BinaryExpression, tools: Tools): ts.Node | undefined {
  const { left, right, operatorToken } = node;
  if (!ts.isIdentifier(left) || !isNamingAssignment(operatorToken.kind)) return undefined;
  const { rewrite, visit } = tools;
  if (rewrite.classify(left) === "local") return undefined;
  // the target first, as the other rules visit a binary expression: the analysis lists uses in source order
  const target = visit.expression(left);
  const value = keepName(rewrite.factory, left.text, right, visit.expression(right));
  return rewrite.factory.updateBinaryExpression(node, target, operatorToken, value);
}

function expressionRule(node: ts.Node, tools: Tools): ts.Node | undefined {
  const { rewrite, visitor } = tools;
  if (ts.isIdentifier(node)) return visitIdentifier(node, tools);
  if (ts.isBinaryExpression(node)) return visitNamingAssignment(node, tools);
  if (ts.isShorthandPropertyAssignment(node)) return visitShorthand(node, tools);
  if (ts.isTypeOfExpression(node)) return visitTypeOf(node, tools);
  if (ts.isCallExpression(node)) return visitCall(node, rewrite, visitor);
  if (ts.isTaggedTemplateExpression(node)) return visitTaggedTemplate(node, rewrite, visitor);
  if (node.kind === ts.SyntaxKind.ThisKeyword && isTopLevelThis(node)) {
    return ts.setSourceMapRange(rewrite.factory.createVoidZero(), node);
  }
  return undefined;
}

/** Rule 5: a `var` below the top level but in the cell's function scope is assigned on `__scope`. */
function variableRule(node: ts.Node, { variables }: Tools): ts.Node | undefined {
  if (ts.isVariableStatement(node)) {
    return isTopLevelVarList(node.declarationList) ? variables.nestedStatement(node) : undefined;
  }
  if (!ts.isForStatement(node) && !ts.isForInStatement(node) && !ts.isForOfStatement(node)) {
    return undefined;
  }
  const list = node.initializer;
  if (!list || !ts.isVariableDeclarationList(list) || !isTopLevelVarList(list)) return undefined;
  return ts.isForStatement(node) ? variables.forLoop(node, list) : variables.forInOrOf(node, list);
}

/** The visitor of one cell: `node` for `ts.visitNode`, `expression` and `statement` for typed children. */
export function createVisitor(rewrite: Rewrite): Visit & { readonly node: ts.Visitor } {
  const visitor: ts.Visitor = (node) => {
    if (isTypeLevel(node)) return node;
    return (
      expressionRule(node, tools) ??
      variableRule(node, tools) ??
      ts.visitEachChild(node, visitor, rewrite.context)
    );
  };
  const visit: Visit = {
    expression: (expression) => ts.visitNode(expression, visitor, ts.isExpression) ?? expression,
    statement: (statement) => ts.visitNode(statement, visitor, ts.isStatement) ?? statement,
  };
  const tools: Tools = { rewrite, visitor, visit, variables: createVariableRules(rewrite, visit) };
  return { ...visit, node: visitor };
}
