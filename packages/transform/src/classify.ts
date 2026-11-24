// Classifies an identifier reference through the TypeScript binder: free, declared at top level, or local to a nested scope.
import ts from "typescript";

import { scopeContainerOf } from "./containers.js";

/**
 * `free`: no declaration in the cell (a global, another cell's name, or nothing); `top`: declared at the cell's
 * top level; `local`: declared below it (a parameter, a local, a loop variable, a catch binding, a member).
 * `free` and `top` references become `__scope.<name>`; only `free` reads are `uses`.
 */
export type Classification = "free" | "top" | "local";

export type Classify = (id: ts.Identifier) => Classification;

/** `undefined` is immutable and `arguments` is per function: their symbols have no declarations but are never scoped. */
const neverScoped = new Set(["undefined", "arguments"]);

/** Builds the classifier of one cell; shorthand `{ x }` resolves through the value symbol, not the property. */
export function createClassify(checker: ts.TypeChecker, file: ts.SourceFile): Classify {
  // A cell names the same symbol many times; walking its declarations once per symbol is what keeps the budget.
  const known = new Map<ts.Symbol, Classification>();
  const classifySymbol = (symbol: ts.Symbol | undefined): Classification => {
    const declarations = symbol?.declarations ?? [];
    if (!symbol || declarations.length === 0) return "free";
    const cached = known.get(symbol);
    if (cached) return cached;
    const atTopLevel = declarations.every(
      (declaration) =>
        declaration.getSourceFile() === file && scopeContainerOf(declaration) === file,
    );
    const result = atTopLevel ? "top" : "local";
    known.set(symbol, result);
    return result;
  };

  return (id) => {
    if (neverScoped.has(id.text)) return "local";
    const parent: ts.Node = id.parent;
    const symbol =
      ts.isShorthandPropertyAssignment(parent) && parent.name === id
        ? checker.getShorthandAssignmentValueSymbol(parent)
        : checker.getSymbolAtLocation(id);
    return classifySymbol(symbol);
  };
}
