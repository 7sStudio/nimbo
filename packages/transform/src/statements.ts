// The cell's top-level statements: dispatch, function hoisting and the async wrapper.
import { DefaultExport, UnsupportedSyntax } from "@jsnb/core";
import ts from "typescript";

import { convertClass, convertFunction, hasModifier } from "./declarations.js";
import { convertExport } from "./exports.js";
import { convertImport } from "./imports.js";
import type { Rewrite } from "./rewrite.js";
import { exportStatement } from "./rewrite.js";
import type { VariableRules, Visit } from "./variables.js";
import { createVariableRules } from "./variables.js";
import { createVisitor } from "./visitor.js";

type Tools = {
  readonly rewrite: Rewrite;
  readonly visit: Visit;
  readonly variables: VariableRules;
  /** The last real statement of the cell: a trailing `;` or comment does not change it. */
  readonly last: ts.Statement | undefined;
};

/** The names a converted declarator assigns: `__scope.x = e` → `x`; a pattern → its `__scope.*` leaves. */
function assignedNames(assignment: ts.Expression): string[] {
  const names: string[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === "__scope") names.push(node.name.text);
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      walk(node.left);
      return;
    }
    ts.forEachChild(node, walk);
  };
  if (ts.isBinaryExpression(assignment)) walk(assignment.left);
  return names;
}

/** One statement per declarator; `export` adds `__scope.__export("x")` per declared name. */
function convertVariables(statement: ts.VariableStatement, tools: Tools): ts.Statement[] {
  const { rewrite, variables } = tools;
  const exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
  return variables.assignments(statement.declarationList).flatMap((assignment) => {
    const expression = rewrite.factory.createExpressionStatement(assignment);
    const out: ts.Statement[] = [ts.setSourceMapRange(expression, statement)];
    const names = exported ? assignedNames(assignment) : [];
    for (const name of names) out.push(exportStatement(rewrite, name, undefined, statement));
    return out;
  });
}

/** The last top-level expression statement becomes `return (expr);`. */
function returnValue(statement: ts.ExpressionStatement, { rewrite, visit }: Tools): ts.Statement {
  const { factory } = rewrite;
  const value = factory.createParenthesizedExpression(visit.expression(statement.expression));
  return ts.setSourceMapRange(factory.createReturnStatement(value), statement);
}

/** The top-level forms that are errors: `export default`, `export =`, top-level `enum`, `namespace`, `import x = require`. */
function reject(statement: ts.Statement, rewrite: Rewrite): void {
  if (hasModifier(statement, ts.SyntaxKind.DefaultKeyword) || ts.isExportAssignment(statement)) {
    throw new DefaultExport(rewrite.at(statement));
  }
  if (hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) return;
  if (ts.isEnumDeclaration(statement)) {
    throw new UnsupportedSyntax({ construct: "enum", ...rewrite.at(statement) });
  }
  if (ts.isModuleDeclaration(statement)) {
    throw new UnsupportedSyntax({ construct: "namespace", ...rewrite.at(statement) });
  }
  if (ts.isImportEqualsDeclaration(statement)) {
    throw new UnsupportedSyntax({ construct: "import require", ...rewrite.at(statement) });
  }
  // A top-level `using` would become a plain assignment and never dispose; nested ones are the emitter's.
  if (ts.isVariableStatement(statement) && statement.declarationList.flags & ts.NodeFlags.Using) {
    throw new UnsupportedSyntax({ construct: "using", ...rewrite.at(statement) });
  }
}

/** Ambient and type-only statements emit nothing: `declare …`, `interface`, `type`. */
function isDropped(statement: ts.Statement): boolean {
  return (
    hasModifier(statement, ts.SyntaxKind.DeclareKeyword) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement)
  );
}

function convert(statement: ts.Statement, tools: Tools): ts.Statement[] {
  const { rewrite, visit } = tools;
  reject(statement, rewrite);
  if (isDropped(statement)) return [];
  if (ts.isFunctionDeclaration(statement)) return convertFunction(statement, rewrite, visit);
  if (ts.isVariableStatement(statement)) return convertVariables(statement, tools);
  if (ts.isClassDeclaration(statement)) return convertClass(statement, rewrite, visit);
  if (ts.isImportDeclaration(statement)) return convertImport(statement, rewrite);
  if (ts.isExportDeclaration(statement)) return convertExport(statement, rewrite);
  if (statement === tools.last && ts.isExpressionStatement(statement)) {
    return [returnValue(statement, tools)];
  }
  return [visit.statement(statement)];
}

function wrapper(factory: ts.NodeFactory, statements: ts.Statement[]): ts.Statement {
  const useStrict = factory.createExpressionStatement(factory.createStringLiteral("use strict"));
  const arrow = factory.createArrowFunction(
    [factory.createModifier(ts.SyntaxKind.AsyncKeyword)],
    undefined,
    [factory.createParameterDeclaration(undefined, undefined, "__scope")],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    factory.createBlock([useStrict, ...statements], true),
  );
  return factory.createExpressionStatement(factory.createParenthesizedExpression(arrow));
}

/** Rewrites the cell into `(async (__scope) => { "use strict"; <hoisted functions> <the rest> });`. */
export function rewriteStatements(rewrite: Rewrite): ts.SourceFile {
  const visit = createVisitor(rewrite);
  const statements = rewrite.file.statements.filter((s) => !ts.isEmptyStatement(s));
  const tools: Tools = {
    rewrite,
    visit,
    variables: createVariableRules(rewrite, visit),
    last: statements.at(-1),
  };
  const hoisted: ts.Statement[] = [];
  const body: ts.Statement[] = [];
  for (const statement of statements) {
    (ts.isFunctionDeclaration(statement) ? hoisted : body).push(...convert(statement, tools));
  }
  const all = [...hoisted, ...body];
  return rewrite.factory.updateSourceFile(rewrite.file, [wrapper(rewrite.factory, all)]);
}
