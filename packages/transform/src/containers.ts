// Where a declaration or a node lives in the cell: its scope container, function container, and the top-level checks.
import ts from "typescript";

function isFunctionBoundary(node: ts.Node): boolean {
  return (
    ts.isFunctionLike(node) ||
    ts.isClassLike(node) ||
    ts.isClassStaticBlockDeclaration(node) ||
    ts.isModuleBlock(node)
  );
}

function isBlockBoundary(node: ts.Node): boolean {
  return (
    ts.isBlock(node) ||
    ts.isCaseBlock(node) ||
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isCatchClause(node)
  );
}

/** The parent of `node`, typed honestly: the source file has none. */
function parentOf(node: ts.Node): ts.Node | undefined {
  return node.parent;
}

/** `var` is function-scoped; everything else (let, const, class, function, catch, import) is block-scoped. */
function isBlockScoped(declaration: ts.Declaration): boolean {
  if (ts.isVariableDeclaration(declaration) && ts.isCatchClause(declaration.parent)) return true;
  if (ts.isVariableDeclaration(declaration) || ts.isBindingElement(declaration)) {
    const list = ts.findAncestor(declaration, ts.isVariableDeclarationList);
    return list ? (list.flags & ts.NodeFlags.BlockScoped) !== 0 : true;
  }
  return true;
}

/** The node whose scope holds `declaration`: the source file, a function, a class or a block. */
export function scopeContainerOf(declaration: ts.Declaration): ts.Node | undefined {
  // A named function or class expression binds its own name inside itself only.
  if (ts.isFunctionExpression(declaration) || ts.isClassExpression(declaration)) return declaration;
  const blockScoped = isBlockScoped(declaration);
  let node = parentOf(declaration);
  while (node) {
    if (ts.isSourceFile(node) || isFunctionBoundary(node)) return node;
    if (blockScoped && isBlockBoundary(node)) return node;
    node = parentOf(node);
  }
  return undefined;
}

/** The nearest function-like container of `node`, or the source file. */
function functionContainerOf(node: ts.Node): ts.Node | undefined {
  let current = parentOf(node);
  while (current) {
    if (ts.isSourceFile(current) || isFunctionBoundary(current)) return current;
    current = parentOf(current);
  }
  return undefined;
}

/** True when `node` sits in the cell's own function scope (not inside a nested function or class). */
export function isAtTopLevel(node: ts.Node): boolean {
  const container = functionContainerOf(node);
  return container !== undefined && ts.isSourceFile(container);
}

/** True when a `var` list belongs to the cell's top-level function scope (treated as top level). */
export function isTopLevelVarList(list: ts.VariableDeclarationList): boolean {
  if (list.flags & ts.NodeFlags.BlockScoped) return false;
  return isAtTopLevel(list);
}

/** True when `this` at `node` is the cell's own `this`: arrows are transparent, functions and classes are not. */
export function isTopLevelThis(node: ts.Node): boolean {
  let current = parentOf(node);
  while (current) {
    if (ts.isSourceFile(current)) return true;
    if (!ts.isArrowFunction(current) && isFunctionBoundary(current)) return false;
    current = parentOf(current);
  }
  return true;
}
