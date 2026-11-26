// Binding patterns of declarations: their identifiers, and their conversion into assignment patterns with `__scope.x` leaves.
import ts from "typescript";

import { keepName } from "./named.js";

export type PatternContext = {
  readonly factory: ts.NodeFactory;
  /** `__scope.<name>` with the source-map range of `range`. */
  scoped(name: string, range: ts.Node): ts.Expression;
  /** Visits an expression nested in the pattern (a default value, a computed key). */
  visitExpression(expression: ts.Expression): ts.Expression;
};

/** Every identifier a binding name declares, in source order (`{ a, b: [c] }` → `a`, `c`). */
export function bindingIdentifiers(name: ts.BindingName): ts.Identifier[] {
  if (ts.isIdentifier(name)) return [name];
  const out: ts.Identifier[] = [];
  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) out.push(...bindingIdentifiers(element.name));
  }
  return out;
}

/**
 * `const { a, b: [c, d = 4], ...rest } = e` → the target `{ a: __scope.a, b: [__scope.c, __scope.d = 4], ...__scope.rest }`:
 * defaults, rest, holes, nesting and computed keys are kept.
 */
export function toAssignmentPattern(
  pattern: ts.BindingPattern,
  ctx: PatternContext,
): ts.ObjectLiteralExpression | ts.ArrayLiteralExpression {
  const { factory } = ctx;
  if (ts.isObjectBindingPattern(pattern)) {
    const properties = pattern.elements.map((element) => toObjectProperty(element, ctx));
    return ts.setSourceMapRange(factory.createObjectLiteralExpression(properties, false), pattern);
  }
  const elements = pattern.elements.map((element) =>
    ts.isOmittedExpression(element)
      ? factory.createOmittedExpression()
      : toArrayElement(element, ctx),
  );
  return ts.setSourceMapRange(factory.createArrayLiteralExpression(elements, false), pattern);
}

function toObjectProperty(
  element: ts.BindingElement,
  ctx: PatternContext,
): ts.ObjectLiteralElementLike {
  const { factory } = ctx;
  const target = targetOf(element, ctx);
  if (element.dotDotDotToken) return factory.createSpreadAssignment(target);
  const key = element.propertyName ?? element.name;
  if (!isPropertyName(key)) throw new Error("an object binding element has no property name");
  const name = ts.isComputedPropertyName(key)
    ? factory.updateComputedPropertyName(key, ctx.visitExpression(key.expression))
    : key;
  return ts.setSourceMapRange(factory.createPropertyAssignment(name, target), element);
}

function toArrayElement(element: ts.BindingElement, ctx: PatternContext): ts.Expression {
  const target = targetOf(element, ctx);
  return element.dotDotDotToken ? ctx.factory.createSpreadElement(target) : target;
}

/** The assignment target of one element: `__scope.x` or a nested pattern, with its default kept. */
function targetOf(element: ts.BindingElement, ctx: PatternContext): ts.Expression {
  const base = ts.isIdentifier(element.name)
    ? ctx.scoped(element.name.text, element.name)
    : toAssignmentPattern(element.name, ctx);
  const { initializer, name } = element;
  if (!initializer) return base;
  const value = ctx.visitExpression(initializer);
  const named = ts.isIdentifier(name)
    ? keepName(ctx.factory, name.text, initializer, value)
    : value;
  const withDefault = ctx.factory.createAssignment(base, named);
  return ts.setSourceMapRange(withDefault, element);
}

function isPropertyName(node: ts.Node): node is ts.PropertyName {
  return (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    ts.isComputedPropertyName(node) ||
    ts.isPrivateIdentifier(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isBigIntLiteral(node)
  );
}
