// Rename across cells and across the bridge. TypeScript finds the locations in the
// virtual files; those in generated lines are dropped, and the bridge is crossed through each client cell's
// declaration of a server export, whose inner `import("…").name` the client service reports as a reference.
import type { CellId } from "@jsnb/core";
import { isReservedName } from "@jsnb/core";
import ts from "typescript";

import type { At, Lookup } from "./lookup.js";
import type { RenameResult } from "./types.js";
import type { VirtualCell } from "./virtual.js";
import { renameTexts } from "./renameText.js";
import { inSource } from "./virtual.js";
import type { Realm } from "./visibility.js";

type Location = { readonly fileName: string; readonly start: number; readonly length: number };

const find = (lookup: Lookup, realm: Realm, fileName: string, offset: number): Location[] =>
  (
    lookup.service(realm).findRenameLocations(fileName, offset, false, false, {
      providePrefixAndSuffixTextForRename: false,
    }) ?? []
  ).map((location) => ({ fileName: location.fileName, ...location.textSpan }));

/** The server declaration a client cell's bridge name stands for, when `at` is on one. */
function bridgeTarget(lookup: Lookup, at: At): Location | undefined {
  if (at.cell.realm !== "client") return undefined;
  const service = lookup.service("client");
  for (const definition of service.getDefinitionAtPosition(at.cell.fileName, at.offset) ?? []) {
    const cell = lookup.file(definition.fileName);
    const link = cell?.links.find((candidate) => candidate.declared === definition.textSpan.start);
    if (!cell || !link) continue;
    const target = service.getDefinitionAtPosition(cell.fileName, link.target)?.[0];
    if (target) return { fileName: target.fileName, ...target.textSpan };
  }
  return undefined;
}

/** The client cells' uses of a server name: through each bridge declaration the client service reaches from it. */
function acrossBridge(lookup: Lookup, server: readonly Location[]): Location[] {
  if (!lookup.cells().some((cell) => cell.realm === "client")) return [];
  const program = lookup.service("client").getProgram();
  const reachable = server.filter((location) => program?.getSourceFile(location.fileName));
  const inCell = (location: Location): boolean => {
    const cell = lookup.file(location.fileName);
    return cell !== undefined && inSource(cell, location.start);
  };
  const start = reachable.find(inCell) ?? reachable[0];
  if (!start) return [];
  const found = find(lookup, "client", start.fileName, start.start);
  const uses: Location[] = [...found];
  for (const location of found) {
    const cell = lookup.file(location.fileName);
    const link = cell?.links.find((candidate) => candidate.target === location.start);
    if (cell && link) uses.push(...find(lookup, "client", cell.fileName, link.declared));
  }
  return uses;
}

/** The locations' edits on each touched cell's source, in document order. */
function edits(
  lookup: Lookup,
  locations: readonly Location[],
  rename: { readonly to: string; readonly kind: string },
): { cell: CellId; source: string }[] {
  const byCell = new Map<VirtualCell, Map<number, number>>();
  for (const { fileName, start, length } of locations) {
    const cell = lookup.file(fileName);
    if (!cell || !inSource(cell, start) || !inSource(cell, start + length)) continue;
    const spans = byCell.get(cell) ?? new Map<number, number>();
    spans.set(start, length);
    byCell.set(cell, spans);
  }
  return lookup.cells().flatMap((cell) => {
    const spans = byCell.get(cell);
    if (!spans) return [];
    const texts = renameTexts(cell, [...spans.keys()], rename.to, rename.kind);
    let source = cell.source;
    for (const [start, length] of [...spans].sort((a, b) => b[0] - a[0])) {
      const text = texts.get(start);
      const at = start - cell.start;
      if (text !== null)
        source = `${source.slice(0, at)}${text ?? rename.to}${source.slice(at + length)}`;
    }
    return source === cell.source ? [] : [{ cell: cell.id, source }];
  });
}

/** True when `name` scans as one identifier, not a keyword. */
function isIdentifier(name: string): boolean {
  const scanner = ts.createScanner(ts.ScriptTarget.ESNext, true, ts.LanguageVariant.Standard, name);
  return scanner.scan() === ts.SyntaxKind.Identifier && scanner.getTokenEnd() === name.length;
}

/** Why the name at `at` cannot become `to`, or the kind of the symbol renamed when it can. */
function refusal(lookup: Lookup, at: At, to: string): { refused: string } | { kind: string } {
  const no = (refused: string) => ({ refused });
  if (!isIdentifier(to)) return no(`${to} is not a valid name.`);
  if (isReservedName(to)) return no(`${to} is reserved for the notebook's own use.`);
  const service = lookup.service(at.cell.realm);
  const info = service.getRenameInfo(at.cell.fileName, at.offset, {
    allowRenameOfImportPath: false,
  });
  if (!info.canRename) return no(info.localizedErrorMessage);
  const definitions = service.getDefinitionAtPosition(at.cell.fileName, at.offset) ?? [];
  if (definitions.some((d) => /\/__jsnb_[^/]*\.d\.ts$/u.test(d.fileName)))
    return no(`${info.displayName} is a built-in of the notebook and cannot be renamed.`);
  return { kind: info.kind };
}

const cannot = { refused: "This name cannot be renamed." } as const;

export function rename(lookup: Lookup, at: At, to: string): RenameResult {
  const allowed = refusal(lookup, at, to);
  if ("refused" in allowed) return allowed;
  const bridged = bridgeTarget(lookup, at);
  const startCell = bridged ? lookup.file(bridged.fileName) : at.cell;
  if (!startCell) return cannot;
  const own = find(lookup, startCell.realm, startCell.fileName, bridged?.start ?? at.offset);
  const crossed = startCell.realm === "server" ? acrossBridge(lookup, own) : [];
  const result = edits(lookup, [...own, ...crossed], { to, kind: allowed.kind });
  return result.length > 0 ? { edits: result } : cannot;
}
