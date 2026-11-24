// The names functions and classes take from what they are assigned to (ECMA-262 NamedEvaluation): `const f = () => 1`
// gives the arrow the name "f", but `__scope.f = () => 1`, a property assignment, gives it none. The rewrite keeps the
// name by defining the value as a property of that name instead, `{ f: () => 1 }.f`, which names it in the same step
// of the evaluation as the declaration would (before a class's static fields run), with nothing else changed.
import ts from "typescript";

/** `node` without the parentheses, `as`, `<T>`, `satisfies` and `!` around it: the emitter keeps only parentheses. */
function innermost(node: ts.Expression): ts.Expression {
  let inner = node;
  while (
    ts.isParenthesizedExpression(inner) ||
    ts.isAsExpression(inner) ||
    ts.isTypeAssertionExpression(inner) ||
    ts.isSatisfiesExpression(inner) ||
    ts.isNonNullExpression(inner)
  ) {
    inner = inner.expression;
  }
  return inner;
}

/** True when `node`, through parentheses and type-only wrappers, is an arrow, an anonymous function or class
 * expression: the values a declaration or an assignment to a plain name gives its name (IsAnonymousFunctionDefinition). */
function isAnonymousDefinition(node: ts.Expression): boolean {
  const inner = innermost(node);
  if (ts.isArrowFunction(inner)) return true;
  return (
    (ts.isFunctionExpression(inner) || ts.isClassExpression(inner)) && inner.name === undefined
  );
}

/** `{ <name>: value }.<name>` (a computed key for `__proto__`, which an object literal would take as the prototype). */
function definedAs(factory: ts.NodeFactory, name: string, value: ts.Expression): ts.Expression {
  const proto = name === "__proto__";
  const key = proto
    ? factory.createComputedPropertyName(factory.createStringLiteral(name))
    : factory.createIdentifier(name);
  const holder = factory.createObjectLiteralExpression([
    factory.createPropertyAssignment(key, value),
  ]);
  const read = proto
    ? factory.createElementAccessExpression(holder, factory.createStringLiteral(name))
    : factory.createPropertyAccessExpression(holder, name);
  return ts.setSourceMapRange(read, value);
}

/** `value` (the visited form of `original`) named `name` as `original` would be when assigned to a plain name. */
export function keepName(
  factory: ts.NodeFactory,
  name: string,
  original: ts.Expression,
  value: ts.Expression,
): ts.Expression {
  return isAnonymousDefinition(original) ? definedAs(factory, name, value) : value;
}

/** The assignment operators whose right side takes the target's name: `=`, `&&=`, `||=`, `??=`. */
export function isNamingAssignment(kind: ts.SyntaxKind): boolean {
  return (
    kind === ts.SyntaxKind.EqualsToken ||
    kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken ||
    kind === ts.SyntaxKind.BarBarEqualsToken ||
    kind === ts.SyntaxKind.QuestionQuestionEqualsToken
  );
}
