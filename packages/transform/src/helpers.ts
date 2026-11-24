// Moves the emit helpers the TypeScript transforms request (decorators, `using`) inside the wrapper, so a cell defines no global.
import ts from "typescript";

/** The printer's order: by priority, undefined last; dependencies were already requested before their dependents. */
function byPriority(a: ts.EmitHelper, b: ts.EmitHelper): number {
  if (a.priority === b.priority) return 0;
  if (a.priority === undefined) return 1;
  if (b.priority === undefined) return -1;
  return a.priority - b.priority;
}

/** The helper's source text; a helper text function wants unique names, and the cell's wrapper body has none to clash with. */
function textOf(helper: ts.EmitHelper): string {
  return typeof helper.text === "string" ? helper.text : helper.text((name) => name);
}

/** One statement per distinct file-level helper, printed verbatim (an identifier prints its text as is and maps to nothing). */
function helperStatements(file: ts.SourceFile, factory: ts.NodeFactory): ts.Statement[] {
  const seen = new Set<string>();
  const helpers = (ts.getEmitHelpers(file) ?? []).filter((helper) => {
    if (helper.scoped || seen.has(helper.name)) return false;
    seen.add(helper.name);
    return true;
  });
  return [...helpers]
    .sort(byPriority)
    .map((helper) =>
      factory.createExpressionStatement(factory.createIdentifier(textOf(helper).trim())),
    );
}

/** The wrapper's arrow function, when the file is `(async (__scope) => { … });` as the rewrite leaves it. */
function wrapperOf(file: ts.SourceFile): ts.ArrowFunction | undefined {
  const [statement] = file.statements;
  if (!statement || !ts.isExpressionStatement(statement)) return undefined;
  const { expression } = statement;
  if (!ts.isParenthesizedExpression(expression) || !ts.isArrowFunction(expression.expression)) {
    return undefined;
  }
  return expression.expression;
}

/**
 * An `after` transformer: with `noEmitHelpers` the printer writes no helper, so the helpers the TypeScript transforms
 * attached to the file are placed in the wrapper body right after `"use strict"`; the output always starts at the wrapper.
 */
export const moveHelpersInside: ts.TransformerFactory<ts.SourceFile> = (context) => (file) => {
  const { factory } = context;
  const arrow = wrapperOf(file);
  const helpers = helperStatements(file, factory);
  if (!arrow || helpers.length === 0 || !ts.isBlock(arrow.body)) return file;
  const [useStrict, ...rest] = arrow.body.statements;
  if (!useStrict) return file;
  const body = factory.updateBlock(arrow.body, [useStrict, ...helpers, ...rest]);
  const updated = factory.updateArrowFunction(
    arrow,
    arrow.modifiers,
    arrow.typeParameters,
    arrow.parameters,
    arrow.type,
    arrow.equalsGreaterThanToken,
    body,
  );
  const statement = factory.createExpressionStatement(
    factory.createParenthesizedExpression(updated),
  );
  return factory.updateSourceFile(file, [statement]);
};
