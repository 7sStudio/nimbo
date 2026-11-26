// `import` declarations → `await __scope.__import("p")` with its bindings assigned on `__scope`.
import ts from "typescript";

import type { Rewrite } from "./rewrite.js";
import { declare } from "./rewrite.js";

/** `import * as ns from "p"` → `__scope.ns = <load>;`; a default beside it is read from `ns.default`. */
function namespaceImport(
  clause: ts.ImportClause,
  bindings: ts.NamespaceImport,
  load: ts.Expression,
  rewrite: Rewrite,
): ts.Expression[] {
  const { factory } = rewrite;
  // The default binding is declared first: `analysis.defines` keeps source order.
  if (clause.name) declare(rewrite, clause.name, "import");
  declare(rewrite, bindings.name, "import");
  const namespace = (): ts.Expression => rewrite.scoped(bindings.name.text, bindings.name);
  const out = [factory.createAssignment(namespace(), load)];
  if (clause.name) {
    const fromNamespace = factory.createPropertyAccessExpression(namespace(), "default");
    out.push(
      factory.createAssignment(rewrite.scoped(clause.name.text, clause.name), fromNamespace),
    );
  }
  return out;
}

/** `{ default: __scope.d, a: __scope.b }` for the default and named (non-type) bindings of the clause. */
function namedProperties(clause: ts.ImportClause, rewrite: Rewrite): ts.PropertyAssignment[] {
  const { factory } = rewrite;
  const properties: ts.PropertyAssignment[] = [];
  if (clause.name) {
    declare(rewrite, clause.name, "import");
    const target = rewrite.scoped(clause.name.text, clause.name);
    properties.push(factory.createPropertyAssignment("default", target));
  }
  const bindings = clause.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return properties;
  for (const element of bindings.elements) {
    if (element.isTypeOnly) continue;
    declare(rewrite, element.name, "import");
    const key = element.propertyName ?? element.name;
    const name = ts.isIdentifier(key) ? key : factory.createStringLiteral(key.text);
    const target = rewrite.scoped(element.name.text, element.name);
    properties.push(factory.createPropertyAssignment(name, target));
  }
  return properties;
}

/**
 * `import d, { a as b } from "p"` → `({ default: __scope.d, a: __scope.b } = await __scope.__import("p"));`;
 * `import * as ns from "p"` → `__scope.ns = await __scope.__import("p");`; `import "p"` → `await __scope.__import("p");`;
 * type-only imports vanish; import attributes are dropped (the realm resolves the specifier, not the script).
 */
export function convertImport(declaration: ts.ImportDeclaration, rewrite: Rewrite): ts.Statement[] {
  const { factory } = rewrite;
  const clause = declaration.importClause;
  if (clause?.phaseModifier === ts.SyntaxKind.TypeKeyword) return [];
  if (!ts.isStringLiteral(declaration.moduleSpecifier)) return [];
  const specifier = declaration.moduleSpecifier.text;
  rewrite.recorder.import(specifier);
  const load = (): ts.Expression =>
    factory.createAwaitExpression(
      rewrite.plumbing("__import", [factory.createStringLiteral(specifier)], declaration),
    );
  const statement = (expression: ts.Expression): ts.Statement =>
    ts.setSourceMapRange(factory.createExpressionStatement(expression), declaration);
  if (!clause) return [statement(load())];
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) {
    return namespaceImport(clause, bindings, load(), rewrite).map(statement);
  }
  const properties = namedProperties(clause, rewrite);
  if (properties.length === 0) return [statement(load())];
  const pattern = factory.createObjectLiteralExpression(properties, false);
  return [statement(factory.createAssignment(pattern, load()))];
}
