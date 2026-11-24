// The text a rename puts at one location. TypeScript's locations, asked for without prefix
// and suffix text so that they cross the cells' generated imports and exports, would turn a shorthand `{ total }` into
// `{ sum }` and a destructured `const { a } = obj` into `const { b } = obj`: the object's key, or the property read,
// would change with the name. Those two places keep the property and rename the value, or the other way round.
import ts from "typescript";

import type { VirtualCell } from "./virtual.js";

/** The identifier that starts at `offset` in `file`, if any. */
function identifierAt(file: ts.SourceFile, offset: number): ts.Identifier | undefined {
  let found: ts.Identifier | undefined;
  const visit = (node: ts.Node): void => {
    if (found || offset < node.getStart(file) || offset >= node.end) return;
    if (ts.isIdentifier(node) && node.getStart(file) === offset) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** A shorthand property or a destructured name without its own property name: one name standing for two. */
function isDoubleName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isShorthandPropertyAssignment(parent)) return parent.name === node;
  return (
    ts.isBindingElement(parent) &&
    parent.name === node &&
    parent.propertyName === undefined &&
    parent.dotDotDotToken === undefined &&
    ts.isObjectBindingPattern(parent.parent)
  );
}

/** The identifier names a property here: a key, a member, a property read or the property a destructuring reads. */
function isPropertyName(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isBindingElement(parent)) return parent.propertyName === node;
  const named =
    ts.isPropertyAssignment(parent) ||
    ts.isPropertyAccessExpression(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isMethodSignature(parent) ||
    ts.isGetAccessor(parent) ||
    ts.isSetAccessor(parent);
  return named && parent.name === node;
}

/** Rename kinds whose symbol is a property: the key is what changes, the local value keeps its name. */
const propertyKinds = new Set(["property", "method", "getter", "setter"]);

/** The text at one location, or null to leave it: a property TypeScript added to a variable's rename through a name
 * that stood for both. */
function textAt(node: ts.Identifier | undefined, to: string, property: boolean): string | null {
  if (!node) return to;
  if (isDoubleName(node)) return property ? `${to}: ${node.text}` : `${node.text}: ${to}`;
  return !property && isPropertyName(node) ? null : to;
}

/**
 * The texts to put at each virtual-file offset of `cell` for a rename to `to` of a symbol of `kind`: `to` alone, or
 * `old: to` (a variable) and `to: old` (a property) where one name stood for both, or null where a variable's rename
 * must leave a property alone.
 */
export function renameTexts(
  cell: VirtualCell,
  offsets: readonly number[],
  to: string,
  kind: string,
): Map<number, string | null> {
  const file = ts.createSourceFile(cell.fileName, cell.text, ts.ScriptTarget.ESNext, true);
  const property = propertyKinds.has(kind);
  return new Map(
    offsets.map((offset) => [offset, textAt(identifierAt(file, offset), to, property)]),
  );
}
