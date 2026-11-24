// The language package's answers in LSP's shapes: completion items with LSP's kind
// numbers, hover and signature help as markdown, definitions as locations. Only the fields the page's
// @codemirror/lsp-client reads, so the types are written here rather than taken from a protocol package.
import { pathToFileURL } from "node:url";

import type { CellRange } from "@jsnb/core";
import { cellUrl } from "@jsnb/core";
import type { CompletionEntry, DefinitionTarget, Hover, SignatureHelp } from "@jsnb/language";

type Markup = { readonly kind: "markdown"; readonly value: string };

type LspCompletionItem = {
  readonly label: string;
  readonly kind: number;
  readonly sortText: string;
  readonly insertText?: string;
  readonly detail?: string;
  readonly documentation?: Markup;
};

/** TypeScript's ScriptElementKind → LSP's CompletionItemKind. */
const kinds: Readonly<Record<string, number>> = {
  method: 2,
  function: 3,
  "local function": 3,
  constructor: 4,
  property: 10,
  getter: 10,
  setter: 10,
  var: 6,
  let: 6,
  "local var": 6,
  parameter: 6,
  alias: 6,
  const: 21,
  class: 7,
  "local class": 7,
  interface: 8,
  type: 8,
  "type parameter": 25,
  enum: 13,
  "enum member": 20,
  module: 9,
  "external module name": 9,
  keyword: 14,
  directory: 19,
  script: 17,
  string: 12,
};

const markdown = (value: string): Markup => ({ kind: "markdown", value });

export function completionList(entries: readonly CompletionEntry[]) {
  const items: LspCompletionItem[] = entries.map((entry) => ({
    label: entry.label,
    kind: kinds[entry.kind] ?? 1,
    // a private-by-convention member (`_api`, `_requestSender`) after the public ones, as VS Code lists them; a letter,
    // since the page sorts with localeCompare, which puts punctuation before TypeScript's digits
    sortText: entry.label.startsWith("_") ? `z${entry.sortText}` : entry.sortText,
    ...(entry.insertText === undefined ? {} : { insertText: entry.insertText }),
    ...(entry.detail === undefined ? {} : { detail: entry.detail }),
    ...(entry.documentation ? { documentation: markdown(entry.documentation) } : {}),
  }));
  return { isIncomplete: false, items };
}

/** The signature in a `ts` fence, then the documentation and its tags. */
export function hoverOf(hover: Hover | null) {
  if (!hover) return null;
  const fence = `\`\`\`ts\n${hover.signature}\n\`\`\``;
  const value = hover.documentation ? `${fence}\n\n${hover.documentation}` : fence;
  return { contents: markdown(value), range: hover.range };
}

export function signatureHelpOf(help: SignatureHelp | null) {
  if (!help) return null;
  return {
    signatures: help.signatures.map((signature) => ({
      label: signature.label,
      documentation: markdown(signature.documentation),
      parameters: signature.parameters.map((parameter) => ({
        label: parameter.label,
        documentation: markdown(parameter.documentation),
      })),
    })),
    activeSignature: help.active,
    activeParameter: help.activeParameter,
  };
}

export function locationsOf(
  notebook: string,
  targets: readonly DefinitionTarget[],
): { readonly uri: string; readonly range: CellRange }[] {
  return targets.map((target) =>
    "cell" in target
      ? { uri: cellUrl(notebook, target.cell), range: target.range }
      : {
          // the line in the fragment as well: the page shows a file outside the cells by its path and line
          uri: `${pathToFileURL(target.file).href}#L${String(target.range.start.line + 1)}`,
          range: target.range,
        },
  );
}
