// What an identifier node is in its syntax: a value reference or not, read or written, inside a type or a pattern.
import ts from "typescript";

/** Type-only syntax the TS emitter strips; nothing inside it is a value reference (the `extends` of a class is). */
export function isTypeLevel(node: ts.Node): boolean {
  if (ts.isExpressionWithTypeArguments(node)) return false;
  return (
    ts.isTypeNode(node) ||
    ts.isTypeParameterDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    (ts.isHeritageClause(node) && node.token === ts.SyntaxKind.ImplementsKeyword)
  );
}

/** The slot `id` fills in its parent: a declared or property `name`, a `propertyName`, a `label`, or none. */
function slotOf(
  id: ts.Identifier,
  parent: ts.Node,
): "name" | "propertyName" | "label" | "right" | undefined {
  if ("name" in parent && parent.name === id) return "name";
  if ("propertyName" in parent && parent.propertyName === id) return "propertyName";
  if ("label" in parent && parent.label === id) return "label";
  return ts.isQualifiedName(parent) && parent.right === id ? "right" : undefined;
}

/** True when `id` names a property or member (`o.x`, `{ x: 1 }`, `class { x }`), never a binding or a reference. */
export function isPropertyKey(id: ts.Identifier): boolean {
  const parent: ts.Node = id.parent;
  const slot = slotOf(id, parent);
  if (slot === "propertyName" || slot === "right") return true;
  if (slot !== "name") return false;
  return (
    ts.isPropertyAccessExpression(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isClassElement(parent) ||
    ts.isTypeElement(parent)
  );
}

/** True when `id` reads or writes a value: not a declared name, a property key, a label or `import.meta`. */
export function isReferencePosition(id: ts.Identifier): boolean {
  const parent: ts.Node = id.parent;
  if (slotOf(id, parent) !== undefined) return false;
  return !ts.isShorthandPropertyAssignment(parent) && !ts.isExportSpecifier(parent);
}

export type Access = "read" | "write" | "readwrite";

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function isIncrement(operator: ts.SyntaxKind): boolean {
  return operator === ts.SyntaxKind.PlusPlusToken || operator === ts.SyntaxKind.MinusMinusToken;
}

/** True when `node` is an array or object literal that is the target of a destructuring assignment. */
export function isAssignmentPattern(node: ts.Node): boolean {
  let current: ts.Node = node;
  while (isPatternPart(current)) {
    const parent: ts.Node = current.parent;
    if (ts.isBinaryExpression(parent) && parent.left === current) {
      return parent.operatorToken.kind === ts.SyntaxKind.EqualsToken;
    }
    if (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) {
      return parent.initializer === current;
    }
    current = parent;
  }
  return false;
}

function isPatternPart(node: ts.Node): boolean {
  return (
    ts.isArrayLiteralExpression(node) ||
    ts.isObjectLiteralExpression(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isSpreadElement(node) ||
    ts.isSpreadAssignment(node)
  );
}

/** Whether a referenced identifier is written (`x = e`, `[x] = e`, `for (x of …)`), read, or both (`x++`, `x += e`). */
export function accessOf(id: ts.Identifier): Access {
  const parent: ts.Node = id.parent;
  if (ts.isBinaryExpression(parent) && parent.left === id) {
    if (parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) return "write";
    if (isAssignmentOperator(parent.operatorToken.kind)) return "readwrite";
  }
  if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
    if (isIncrement(parent.operator)) return "readwrite";
  }
  if (ts.isForOfStatement(parent) || ts.isForInStatement(parent)) {
    if (parent.initializer === id) return "write";
  }
  return isAssignmentPattern(parent) ? "write" : "read";
}
