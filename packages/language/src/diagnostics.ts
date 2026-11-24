// TypeScript's diagnostics of a cell file, filtered for notebook semantics: cells are
// almost modules, and what the generated lines cause, or what the scope allows, is not the user's mistake.
import type { Diagnostic } from "@jsnb/core";
import { MissingPackage } from "@jsnb/core";
import { dirname } from "node:path";

import ts from "typescript";

import type { VirtualCell } from "./virtual.js";
import { rangeOf } from "./virtual.js";
import type { Realm } from "./visibility.js";

export type DiagnosticContext = {
  readonly cell: VirtualCell;
  /** The cell's own top-level names. */
  readonly own: ReadonlySet<string>;
  /** Names another cell of the realm declares. */
  readonly sameRealm: ReadonlySet<string>;
  /** Names a cell of the other realm declares. */
  readonly otherRealm: ReadonlySet<string>;
};

const cannotFindName = new Set([2304, 2552]);
const assignToImport = 2632;
const usedBeforeDeclaration = new Set([2448, 2449, 2450, 2454]);
const missingDomGlobal = new Set([2584]);
const missingNodeGlobal = new Set([2580, 2591]);
const cannotFindModule = 2307;

let domNames: ReadonlySet<string> | undefined;

/** The globals lib.dom declares (`window`, `localStorage`, `alert`, …), read once from TypeScript's own file. */
function domGlobals(): ReadonlySet<string> {
  if (domNames) return domNames;
  const path = `${dirname(ts.getDefaultLibFilePath({}))}/lib.dom.d.ts`;
  const file = ts.createSourceFile(path, ts.sys.readFile(path) ?? "", ts.ScriptTarget.ESNext);
  domNames = new Set(
    file.statements.flatMap((statement) => {
      if (ts.isFunctionDeclaration(statement)) return statement.name ? [statement.name.text] : [];
      if (!ts.isVariableStatement(statement)) return [];
      return statement.declarationList.declarations.flatMap((d) =>
        ts.isIdentifier(d.name) ? [d.name.text] : [],
      );
    }),
  );
  return domNames;
}

/** `@scope/name/sub` → `@scope/name`, `name/sub` → `name`. */
function packageName(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

const isBare = (specifier: string): boolean =>
  !/^(\.{1,2}(\/|$)|\/|[a-z][a-z0-9+.-]*:\/\/)/iu.test(specifier);

/** A name the other realm declares: the bridge's NotExported wording, or its mirror (05 §7). */
function crossRealm(realm: Realm, name: string): string {
  return realm === "client"
    ? `${name} is defined in a server cell but not exported. Add export in that cell to use it here.`
    : `${name} is defined in a client cell. Nothing crosses from the page to the server.`;
}

/** A global of the other realm's libraries. */
function wrongRealmGlobal(realm: Realm, code: number, name: string): string | undefined {
  const dom = missingDomGlobal.has(code) || (code === 2304 && domGlobals().has(name));
  if (dom && realm === "server") return `${name} exists in client cells only.`;
  if (missingNodeGlobal.has(code) && realm === "client")
    return `${name} exists in server cells only.`;
  return undefined;
}

/** A module that cannot be found: a package to install, or a Node module in a client cell. */
function missingModule(realm: Realm, literal: string): string | undefined {
  const specifier = literal.replace(/^["'`]|["'`]$/gu, "");
  if (specifier.startsWith("node:"))
    return realm === "client" ? `${specifier} exists in server cells only.` : undefined;
  if (!isBare(specifier)) return undefined;
  const message = new MissingPackage({ names: [packageName(specifier)] }).message;
  return `${message}, or add it in the Packages panel.`;
}

/** The message a notebook user should read instead of TypeScript's, or undefined to keep TypeScript's. */
function replaced(context: DiagnosticContext, code: number, text: string): string | undefined {
  const realm = context.cell.realm;
  if (cannotFindName.has(code) && context.otherRealm.has(text)) return crossRealm(realm, text);
  if (code === cannotFindModule) return missingModule(realm, text);
  return wrongRealmGlobal(realm, code, text);
}

/** True for a diagnostic the scope's semantics make wrong. */
function dropped(context: DiagnosticContext, code: number, text: string): boolean {
  if (code === assignToImport) return !context.own.has(text);
  if (usedBeforeDeclaration.has(code)) return context.sameRealm.has(text);
  return false;
}

const severityOf = (category: ts.DiagnosticCategory): Diagnostic["severity"] | undefined =>
  category === ts.DiagnosticCategory.Error
    ? "error"
    : category === ts.DiagnosticCategory.Warning
      ? "warning"
      : undefined;

/** One TypeScript diagnostic as the cell's, or undefined when it is dropped. */
function mapped(
  context: DiagnosticContext,
  diagnostic: ts.Diagnostic,
  syntactic: boolean,
): Diagnostic | undefined {
  const { cell } = context;
  const severity = severityOf(diagnostic.category);
  const start = diagnostic.start;
  if (!severity || start === undefined || start < cell.start) return undefined;
  const sourceEnd = cell.start + cell.source.length;
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const base = { severity, code: diagnostic.code, source: "ts" } as const;
  if (start > sourceEnd) {
    const end = cell.source.length;
    return syntactic ? { ...base, range: rangeOf(cell, end, end), message } : undefined;
  }
  const length = diagnostic.length ?? 0;
  const text = cell.text.slice(start, start + length);
  if (dropped(context, diagnostic.code, text)) return undefined;
  const end = Math.min(start + length, sourceEnd);
  return {
    ...base,
    range: rangeOf(cell, start - cell.start, end - cell.start),
    message: replaced(context, diagnostic.code, text) ?? message,
  };
}

/** The cell's diagnostics from TypeScript's syntactic and semantic ones for its virtual file. */
export function cellDiagnostics(
  context: DiagnosticContext,
  syntactic: readonly ts.Diagnostic[],
  semantic: readonly ts.Diagnostic[],
): Diagnostic[] {
  const all = [
    ...syntactic.map((d) => mapped(context, d, true)),
    ...semantic.map((d) => mapped(context, d, false)),
  ];
  const seen = new Set<string>();
  return all.filter((d): d is Diagnostic => {
    if (!d) return false;
    const { line, character } = d.range.start;
    const id = `${String(line)}:${String(character)}:${String(d.code)}:${d.message}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
