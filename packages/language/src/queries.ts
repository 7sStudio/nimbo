// Completions, details, hover, signature help and definition for a position in a cell: TypeScript's answers at the virtual offset, mapped back to the cell and cleaned of what the prefix causes.
import { isReservedName } from "@jsnb/core";
import ts from "typescript";

import type { At, Lookup } from "./lookup.js";
import type { CompletionEntry, DefinitionTarget, Details, Hover, SignatureHelp } from "./types.js";
import type { Href } from "./docs.js";
import { documentation, linkedParts, plainParts as parts } from "./docs.js";
import { inSource, rangeOf } from "./virtual.js";

/**
 * Drops TypeScript's `(alias)` marker and the `import name` line a prefix import adds to a signature; an aliased
 * function, which TypeScript prints without its keyword, gets it back.
 */
function cleanSignature(signature: string, kinds: ReadonlyMap<string, string>): string {
  const aliased = signature.startsWith("(alias) ");
  const lines = signature.replace(/^\(alias\) /u, "").split("\n");
  while (lines.length > 1 && (lines.at(-1) ?? "").startsWith("import ")) lines.pop();
  const text = lines.join("\n");
  const name = /^[\w$]+/u.exec(text)?.[0];
  return aliased && name && kinds.get(name) === "function" ? `function ${text}` : text;
}

/** A completion row the generated lines or the transform's names put there, which the user must not see. */
const hidden = (name: string): boolean =>
  name.startsWith("__nimbo_") || name.startsWith("nimbo:") || isReservedName(name);

/** An entry that brings its own text (`?.amount` on a possibly undefined value, `["a-b"]`): the page replaces the `.`
 * before the word with it (editor/language/client.ts). */
function replacementOf(entry: ts.CompletionEntry): Pick<CompletionEntry, "insertText"> {
  return entry.insertText === undefined ? {} : { insertText: entry.insertText };
}

/** A list this long or shorter (a member list) carries each entry's type and documentation. */
export const detailedListMax = 100;

export function completions(lookup: Lookup, at: At): CompletionEntry[] {
  const result = lookup
    .service(at.cell.realm)
    .getCompletionsAtPosition(at.cell.fileName, at.offset, {
      includeCompletionsWithInsertText: true,
      includeAutomaticOptionalChainCompletions: true,
      includeCompletionsForModuleExports: false,
      includeCompletionsForImportStatements: false,
    });
  const entries = (result?.entries ?? []).filter((entry) => !hidden(entry.name));
  const detailed = entries.length <= detailedListMax;
  return entries.map((entry) => {
    const details = detailed ? completionDetails(lookup, at, entry.name) : null;
    return {
      label: entry.name,
      kind:
        entry.kind === ts.ScriptElementKind.alias
          ? (at.cell.importedKinds.get(entry.name) ?? entry.kind)
          : entry.kind,
      sortText: entry.sortText,
      ...replacementOf(entry),
      ...(details ? { detail: details.signature, documentation: details.documentation } : {}),
    };
  });
}

export function completionDetails(lookup: Lookup, at: At, label: string): Details | null {
  const details = lookup
    .service(at.cell.realm)
    .getCompletionEntryDetails(
      at.cell.fileName,
      at.offset,
      label,
      undefined,
      undefined,
      undefined,
      undefined,
    );
  if (!details) return null;
  return {
    signature: cleanSignature(parts(details.displayParts), at.cell.importedKinds),
    documentation: documentation(details.documentation, details.tags, hrefOf(lookup, at)),
  };
}

export function hover(lookup: Lookup, at: At): Hover | null {
  const info = lookup.service(at.cell.realm).getQuickInfoAtPosition(at.cell.fileName, at.offset);
  if (!info) return null;
  const { start, length } = info.textSpan;
  if (!inSource(at.cell, start) || !inSource(at.cell, start + length)) return null;
  return {
    signature: cleanSignature(parts(info.displayParts), at.cell.importedKinds),
    documentation: documentation(info.documentation, info.tags, hrefOf(lookup, at)),
    range: rangeOf(at.cell, start - at.cell.start, start + length - at.cell.start),
  };
}

export function signature(lookup: Lookup, at: At): SignatureHelp | null {
  const help = lookup
    .service(at.cell.realm)
    .getSignatureHelpItems(at.cell.fileName, at.offset, undefined);
  if (!help) return null;
  const href = hrefOf(lookup, at);
  return {
    signatures: help.items.map((item) => {
      const separator = parts(item.separatorDisplayParts);
      const parameters = item.parameters.map((parameter) => ({
        label: parts(parameter.displayParts),
        // JSDoc's `@param name - text` keeps its dash in TypeScript's answer; the hint shows the text alone
        documentation: linkedParts(parameter.documentation, href).replace(/^\s*-\s+/u, ""),
      }));
      // each parameter carries its own text, so the @param tags stay out of the signature's (as VS Code has it)
      const tags = item.tags.filter((tag) => tag.name !== "param");
      return {
        label: `${parts(item.prefixDisplayParts)}${parameters.map((p) => p.label).join(separator)}${parts(item.suffixDisplayParts)}`,
        parameters,
        documentation: documentation(item.documentation, tags, href),
      };
    }),
    active: help.selectedItemIndex,
    activeParameter: help.argumentIndex,
  };
}

/** Where one of TypeScript's definitions is, for the user: a cell's range, a file's line, or nothing (generated). */
function resolveTarget(
  lookup: Lookup,
  definition: Pick<ts.DefinitionInfo, "fileName" | "textSpan">,
  service: ts.LanguageService,
  depth: number,
): DefinitionTarget[] {
  const { fileName, textSpan } = definition;
  const cell = lookup.file(fileName);
  if (cell) {
    if (inSource(cell, textSpan.start))
      return [
        {
          cell: cell.id,
          range: rangeOf(
            cell,
            textSpan.start - cell.start,
            textSpan.start + textSpan.length - cell.start,
          ),
        },
      ];
    const link = cell.links.find((candidate) => candidate.declared === textSpan.start);
    if (!link || depth > 2) return [];
    const next = service.getDefinitionAtPosition(cell.fileName, link.target) ?? [];
    return next.flatMap((target) => resolveTarget(lookup, target, service, depth + 1));
  }
  if (fileName.includes("/__nimbo_")) return [];
  const file = service.getProgram()?.getSourceFile(fileName);
  if (!file) return [];
  const start = file.getLineAndCharacterOfPosition(textSpan.start);
  const end = file.getLineAndCharacterOfPosition(textSpan.start + textSpan.length);
  return [{ file: fileName, range: { start, end } }];
}

/** Where a documentation link to a symbol goes, as the page follows it (editor/language/links.ts):
 * `#nimbo-cell=<cell>:<line>:<character>` for a cell, `#nimbo-file=<path>:<line>` for a file outside the cells. */
function hrefOf(lookup: Lookup, at: At): Href {
  const service = lookup.service(at.cell.realm);
  return (target) => {
    const [place] = resolveTarget(lookup, target, service, 0);
    if (place === undefined) return undefined;
    const { line, character } = place.range.start;
    return "cell" in place
      ? `#nimbo-cell=${place.cell}:${String(line)}:${String(character)}`
      : `#nimbo-file=${encodeURIComponent(place.file)}:${String(line)}`;
  };
}

export function definition(lookup: Lookup, at: At): DefinitionTarget[] {
  const service = lookup.service(at.cell.realm);
  const found = service.getDefinitionAtPosition(at.cell.fileName, at.offset) ?? [];
  const targets = found.flatMap((target) => resolveTarget(lookup, target, service, 0));
  const seen = new Set<string>();
  return targets.filter((target) => {
    const id = JSON.stringify(target);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
