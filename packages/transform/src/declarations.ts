// Top-level functions and classes → assignments on `__scope`, with their `__export` calls.
import { DefaultExport } from "@jsnb/core";
import ts from "typescript";

import type { Rewrite } from "./rewrite.js";
import { declare, exportStatement } from "./rewrite.js";
import type { Visit } from "./variables.js";

export function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return (
    ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false)
  );
}

const droppedOnClasses: readonly ts.SyntaxKind[] = [
  ts.SyntaxKind.ExportKeyword,
  ts.SyntaxKind.DefaultKeyword,
  ts.SyntaxKind.AbstractKeyword,
  ts.SyntaxKind.DeclareKeyword,
];

/** `__scope.<name> = <value>;` plus `__scope.__export("<name>")` when the declaration is exported. */
function assigned(
  declaration: ts.FunctionDeclaration | ts.ClassDeclaration,
  name: ts.Identifier,
  value: ts.Expression,
  rewrite: Rewrite,
): ts.Statement[] {
  const { factory } = rewrite;
  ts.setSourceMapRange(value, declaration);
  const assign = factory.createAssignment(rewrite.scoped(name.text, name), value);
  const statement = factory.createExpressionStatement(assign);
  const out: ts.Statement[] = [ts.setSourceMapRange(statement, declaration)];
  if (hasModifier(declaration, ts.SyntaxKind.ExportKeyword)) {
    out.push(exportStatement(rewrite, name.text, undefined, declaration));
  }
  return out;
}

/**
 * `function f() {}` → `__scope.f = function f() {};` (the caller hoists it); `async` and `*` are kept;
 * an overload signature (no body) emits nothing; `export` adds `__scope.__export("f")`.
 */
export function convertFunction(
  declaration: ts.FunctionDeclaration,
  rewrite: Rewrite,
  visit: Visit,
): ts.Statement[] {
  const { name } = declaration;
  if (!name) throw new DefaultExport(rewrite.at(declaration));
  declare(rewrite, name, "function");
  if (!declaration.body) return [];
  const visited = visit.statement(declaration);
  if (!ts.isFunctionDeclaration(visited) || !visited.body) return [];
  const asyncModifier = visited.modifiers?.filter(
    (m): m is ts.Modifier => m.kind === ts.SyntaxKind.AsyncKeyword,
  );
  const expression = rewrite.factory.createFunctionExpression(
    asyncModifier?.length ? asyncModifier : undefined,
    visited.asteriskToken,
    visited.name,
    visited.typeParameters,
    visited.parameters,
    visited.type,
    visited.body,
  );
  return assigned(declaration, name, expression, rewrite);
}

/** `class C {}` → `__scope.C = class C {};` in place; `export`, `abstract` and `declare` are dropped from the expression. */
export function convertClass(
  declaration: ts.ClassDeclaration,
  rewrite: Rewrite,
  visit: Visit,
): ts.Statement[] {
  const { name } = declaration;
  if (!name) throw new DefaultExport(rewrite.at(declaration));
  declare(rewrite, name, "class");
  const visited = visit.statement(declaration);
  if (!ts.isClassDeclaration(visited)) return [];
  const modifiers = visited.modifiers?.filter((m) => !droppedOnClasses.includes(m.kind));
  const expression = rewrite.factory.createClassExpression(
    modifiers?.length ? modifiers : undefined,
    visited.name,
    visited.typeParameters,
    visited.heritageClauses,
    visited.members,
  );
  return assigned(declaration, name, expression, rewrite);
}
