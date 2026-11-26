// A cell's top-level names: a tolerant scan of the statements of its own parse, so a cell
// with a syntax error still provides what parsed. No binder and no dependency on the transform.
import ts from "typescript";

/** What a name is at run time: a value crosses the bridge, a type only types. A class is both. */
export type NameKind = "value" | "type" | "both";

export type CellDeclarations = {
  /** Every top-level name the cell declares or binds by an import, with its kind. */
  readonly names: ReadonlyMap<string, NameKind>;
  /** The names the cell's own source exports (`export const a`, `export { a }`, `export { a as b }` as `b`), with the
   * kind of what they name: the bridge's exports (transform/src/exports.ts). */
  readonly exported: ReadonlyMap<string, NameKind>;
  /** Every name the cell's own export statements already export (an `as` target included), for the suffix. */
  readonly exportNames: ReadonlySet<string>;
  /** Each name's TypeScript element kind (`const`, `function`, `class`, …), for the completion rows of other cells. */
  readonly elementKinds: ReadonlyMap<string, string>;
};

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((m) => m.kind === kind) ?? false);

/** The names a binding pattern binds, destructured names included. */
function bindingNames(name: ts.BindingName, out: string[]): void {
  if (ts.isIdentifier(name)) {
    out.push(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) bindingNames(element.name, out);
  }
}

type Found = { readonly name: string; readonly kind: NameKind; readonly element: string };

function importNames(node: ts.ImportDeclaration): Found[] {
  const clause = node.importClause;
  if (!clause) return [];
  const typeOnly = clause.phaseModifier === ts.SyntaxKind.TypeKeyword;
  const kindOf = (specifierTypeOnly: boolean): NameKind =>
    typeOnly || specifierTypeOnly ? "type" : "both";
  const alias = (name: string, specifierTypeOnly = false): Found => ({
    name,
    kind: kindOf(specifierTypeOnly),
    element: "alias",
  });
  const bindings = clause.namedBindings;
  return [
    ...(clause.name ? [alias(clause.name.text)] : []),
    ...(bindings && ts.isNamespaceImport(bindings) ? [alias(bindings.name.text)] : []),
    ...(bindings && ts.isNamedImports(bindings)
      ? bindings.elements.map((element) => alias(element.name.text, element.isTypeOnly))
      : []),
  ];
}

function variableNames(statement: ts.VariableStatement): Found[] {
  const names: string[] = [];
  for (const declaration of statement.declarationList.declarations)
    bindingNames(declaration.name, names);
  const flags = statement.declarationList.flags;
  const element = flags & ts.NodeFlags.Const ? "const" : flags & ts.NodeFlags.Let ? "let" : "var";
  return names.map((name) => ({ name, kind: "value", element }));
}

/** A named declaration statement's kind and element kind, by its syntax kind. */
const namedKinds: ReadonlyMap<ts.SyntaxKind, { kind: NameKind; element: string }> = new Map([
  [ts.SyntaxKind.FunctionDeclaration, { kind: "value", element: "function" }],
  [ts.SyntaxKind.ClassDeclaration, { kind: "both", element: "class" }],
  [ts.SyntaxKind.EnumDeclaration, { kind: "both", element: "enum" }],
  [ts.SyntaxKind.InterfaceDeclaration, { kind: "type", element: "interface" }],
  [ts.SyntaxKind.TypeAliasDeclaration, { kind: "type", element: "type" }],
  [ts.SyntaxKind.ImportEqualsDeclaration, { kind: "both", element: "alias" }],
]);

/** The name of a function, class, enum, interface, type alias or `import x =` statement. */
function statementName(statement: ts.Statement): string | undefined {
  const named =
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement);
  return named ? statement.name?.text : undefined;
}

/** The names one top-level statement declares. */
function declared(statement: ts.Statement): Found[] {
  if (ts.isVariableStatement(statement)) return variableNames(statement);
  if (ts.isImportDeclaration(statement)) return importNames(statement);
  const name = statementName(statement);
  const kinds = namedKinds.get(statement.kind);
  return name && kinds ? [{ name, ...kinds }] : [];
}

/** The local names an `export { a, b as c }` without a module specifier exports, and the names it exports them as. */
function exportClause(statement: ts.ExportDeclaration): { local: string; exported: string }[] {
  const clause = statement.exportClause;
  if (statement.moduleSpecifier || !clause || !ts.isNamedExports(clause)) return [];
  return clause.elements.map((element) => {
    const local = element.propertyName ?? element.name;
    const text = (id: ts.ModuleExportName): string => id.text;
    return { local: text(local), exported: text(element.name) };
  });
}

/** `export { z as default }` or `as "a b"` names nothing a client cell could write. */
const isBridgeName = (name: string): boolean =>
  /^[A-Za-z_$][\w$]*$/u.test(name) && name !== "default";

const merge = (a: NameKind | undefined, b: NameKind): NameKind =>
  a === undefined || a === b ? b : "both";

/** A cell's top-level names, from `source` parsed alone as a TypeScript module. */
export function scanDeclarations(source: string): CellDeclarations {
  const file = ts.createSourceFile(
    "cell.ts",
    source,
    ts.ScriptTarget.ESNext,
    false,
    ts.ScriptKind.TS,
  );
  const names = new Map<string, NameKind>();
  const exported = new Map<string, NameKind>();
  const exportNames = new Set<string>();
  const elementKinds = new Map<string, string>();
  const clauses: { local: string; exported: string }[] = [];
  for (const statement of file.statements) {
    const found = declared(statement);
    for (const { name, kind, element } of found) {
      names.set(name, merge(names.get(name), kind));
      if (!elementKinds.has(name)) elementKinds.set(name, element);
    }
    if (hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const { name, kind } of found) {
        exported.set(name, kind);
        exportNames.add(name);
      }
    }
    if (ts.isExportDeclaration(statement)) clauses.push(...exportClause(statement));
  }
  for (const clause of clauses) {
    exportNames.add(clause.exported);
    const kind = names.get(clause.local);
    if (kind && isBridgeName(clause.exported)) exported.set(clause.exported, kind);
  }
  return { names, exported, exportNames, elementKinds };
}
