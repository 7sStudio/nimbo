// `export { a, b as c }` → `__scope.__export(...)` calls (04 §3.2 rule 8); `export … from` and `export *` are rejected.
import { UnsupportedSyntax } from "@jsnb/core";
import ts from "typescript";

import type { Rewrite } from "./rewrite.js";
import { exportStatement } from "./rewrite.js";

/** `export { a, b as c }` → `__scope.__export("a"); __scope.__export("c", "b");`; `export type { … }` vanishes. */
export function convertExport(declaration: ts.ExportDeclaration, rewrite: Rewrite): ts.Statement[] {
  if (declaration.isTypeOnly) return [];
  const clause = declaration.exportClause;
  if (!clause || !ts.isNamedExports(clause)) {
    throw new UnsupportedSyntax({ construct: "export *", ...rewrite.at(declaration) });
  }
  if (declaration.moduleSpecifier) {
    throw new UnsupportedSyntax({ construct: "export from", ...rewrite.at(declaration) });
  }
  const out: ts.Statement[] = [];
  for (const element of clause.elements) {
    if (element.isTypeOnly) continue;
    const exported = element.name.text;
    const local = element.propertyName?.text;
    out.push(exportStatement(rewrite, exported, local === exported ? undefined : local, element));
  }
  return out;
}
