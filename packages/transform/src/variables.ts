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

function kindOf(list: ts.VariableDeclarationList): BindingKind {
  if (list.flags & ts.NodeFlags.Const) return "const";
  return list.flags & ts.NodeFlags.Let ? "let" : "var";
}

function commaList(factory: ts.NodeFactory, expressions: ts.Expression[]): ts.Expression {
  const [first] = expressions;
  if (!first) return factory.createVoidZero();
  return expressions.length === 1 ? first : factory.createCommaListExpression(expressions);
}

/** The variable rules of one cell, sharing the visitor so initializers and loop bodies are rewritten too. */
export function createVariableRules(rewrite: Rewrite, visit: Visit): VariableRules {
  const { factory } = rewrite;
  const patterns: PatternContext = {
    factory,
    scoped: (name, range) => rewrite.scoped(name, range),
    visitExpression: (expression) => visit.expression(expression),
  };

  /** The assignment target of a declarator's name: `__scope.x` or a pattern; every name is declared on the way. */
  const target = (name: ts.BindingName, kind: BindingKind): ts.Expression => {
    for (const id of bindingIdentifiers(name)) declare(rewrite, id, kind);
    return ts.isIdentifier(name)
      ? rewrite.scoped(name.text, name)
      : toAssignmentPattern(name, patterns);
  };

  const assignments = (list: ts.VariableDeclarationList): ts.Expression[] => {
    const kind = kindOf(list);
    return list.declarations.map((declaration) => {
      const left = target(declaration.name, kind);
      const { initializer, name } = declaration;
      let right: ts.Expression;
      if (initializer) {
        const value = visit.expression(initializer);
        // `const f = () => 1` names the arrow "f"; `__scope.f = () => 1` would not (named.ts)
        right = ts.isIdentifier(name) ? keepName(factory, name.text, initializer, value) : value;
      } else {
        right = factory.createIdentifier("undefined");
      }
      return ts.setSourceMapRange(factory.createAssignment(left, right), declaration);
    });
  };

  return {
    assignments,
    nestedStatement: (statement) =>
      ts.setSourceMapRange(
        factory.createExpressionStatement(
          commaList(factory, assignments(statement.declarationList)),
        ),
        statement,
      ),
    forLoop: (statement, list) =>
      factory.updateForStatement(
        statement,
        commaList(factory, assignments(list)),
        statement.condition && visit.expression(statement.condition),
        statement.incrementor && visit.expression(statement.incrementor),
        visit.statement(statement.statement),
      ),
    forInOrOf: (statement, list) => {
      const [declaration] = list.declarations;
      if (!declaration) return statement;
      const left = target(declaration.name, kindOf(list));
      const right = visit.expression(statement.expression);
      const body = visit.statement(statement.statement);
      return ts.isForInStatement(statement)
        ? factory.updateForInStatement(statement, left, right, body)
        : factory.updateForOfStatement(statement, statement.awaitModifier, left, right, body);
    },
  };
}
