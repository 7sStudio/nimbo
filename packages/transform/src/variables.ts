// Variable declarations that belong to the cell's scope → assignments on `__scope` (04 §3.2 rules 1, 2 and 5).
import type { BindingKind } from "@jsnb/core";
import ts from "typescript";

import { keepName } from "./named.js";
import type { PatternContext } from "./patterns.js";
import { bindingIdentifiers, toAssignmentPattern } from "./patterns.js";
import type { Rewrite } from "./rewrite.js";
import { declare } from "./rewrite.js";

/** The typed entry points of the cell visitor, for the rules that rewrite children. */
export type Visit = {
  expression(expression: ts.Expression): ts.Expression;
  statement(statement: ts.Statement): ts.Statement;
};

export type VariableRules = {
  /** One `__scope.x = e` (or `({ … } = e)`) per declarator; `let x;` and `var x;` assign `undefined`. */
  assignments(list: ts.VariableDeclarationList): ts.Expression[];
  /** A `var` statement nested in a top-level block: the assignments as one expression statement. */
  nestedStatement(statement: ts.VariableStatement): ts.Statement;
  /** `for (var i = 0; …)` → `for (__scope.i = 0; …)`. */
  forLoop(statement: ts.ForStatement, list: ts.VariableDeclarationList): ts.Statement;
  /** `for (var k in o)` / `for (var k of o)` → `for (__scope.k in o)` / `for (__scope.k of o)`. */
  forInOrOf(
    statement: ts.ForInStatement | ts.ForOfStatement,
    list: ts.VariableDeclarationList,
  ): ts.Statement;
};

type Tools = {
  readonly rewrite: Rewrite;
  readonly visit: Visit;
  readonly patterns: PatternContext;
};

function kindOf(list: ts.VariableDeclarationList): BindingKind {
  if (list.flags & ts.NodeFlags.Const) return "const";
  return list.flags & ts.NodeFlags.Let ? "let" : "var";
}

/** The assignment target of a declarator's name: `__scope.x` or a pattern; every name is declared on the way. */
function target(name: ts.BindingName, kind: BindingKind, tools: Tools): ts.Expression {
  for (const id of bindingIdentifiers(name)) declare(tools.rewrite, id, kind);
  return ts.isIdentifier(name)
    ? tools.rewrite.scoped(name.text, name)
    : toAssignmentPattern(name, tools.patterns);
}

function assignments(list: ts.VariableDeclarationList, tools: Tools): ts.Expression[] {
  const { factory } = tools.rewrite;
  const kind = kindOf(list);
  return list.declarations.map((declaration) => {
    const left = target(declaration.name, kind, tools);
    const { initializer, name } = declaration;
    // `const f = () => 1` names the arrow "f"; `__scope.f = () => 1` would not (named.ts)
    const right = initializer
      ? ts.isIdentifier(name)
        ? keepName(factory, name.text, initializer, tools.visit.expression(initializer))
        : tools.visit.expression(initializer)
      : factory.createIdentifier("undefined");
    return ts.setSourceMapRange(factory.createAssignment(left, right), declaration);
  });
}

function commaList(factory: ts.NodeFactory, expressions: ts.Expression[]): ts.Expression {
  const [first] = expressions;
  if (!first) return factory.createVoidZero();
  return expressions.length === 1 ? first : factory.createCommaListExpression(expressions);
}

function forLoop(statement: ts.ForStatement, list: ts.VariableDeclarationList, tools: Tools) {
  const { factory } = tools.rewrite;
  return factory.updateForStatement(
    statement,
    commaList(factory, assignments(list, tools)),
    statement.condition && tools.visit.expression(statement.condition),
    statement.incrementor && tools.visit.expression(statement.incrementor),
    tools.visit.statement(statement.statement),
  );
}

function forInOrOf(
  statement: ts.ForInStatement | ts.ForOfStatement,
  list: ts.VariableDeclarationList,
  tools: Tools,
): ts.Statement {
  const { factory } = tools.rewrite;
  const [declaration] = list.declarations;
  if (!declaration) return statement;
  const left = target(declaration.name, kindOf(list), tools);
  const right = tools.visit.expression(statement.expression);
  const body = tools.visit.statement(statement.statement);
  return ts.isForInStatement(statement)
    ? factory.updateForInStatement(statement, left, right, body)
    : factory.updateForOfStatement(statement, statement.awaitModifier, left, right, body);
}

/** The variable rules of one cell, sharing the visitor so initializers and loop bodies are rewritten too. */
export function createVariableRules(rewrite: Rewrite, visit: Visit): VariableRules {
  const { factory } = rewrite;
  const patterns: PatternContext = {
    factory,
    scoped: (name, range) => rewrite.scoped(name, range),
    visitExpression: (expression) => visit.expression(expression),
  };
  const tools: Tools = { rewrite, visit, patterns };
  return {
    assignments: (list) => assignments(list, tools),
    nestedStatement: (statement) =>
      ts.setSourceMapRange(
        factory.createExpressionStatement(
          commaList(factory, assignments(statement.declarationList, tools)),
        ),
        statement,
      ),
    forLoop: (statement, list) => forLoop(statement, list, tools),
    forInOrOf: (statement, list) => forInOrOf(statement, list, tools),
  };
}
