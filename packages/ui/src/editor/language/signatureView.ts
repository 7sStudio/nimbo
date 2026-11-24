// What parameter hints show, as VS Code's widget: the signature in syntax colours with the
// active parameter in the accent, `n/m` before it when there are several, then the active parameter's own text and
// the function's documentation under a thin line.
import type { EditorView } from "@codemirror/view";
import { LSPPlugin } from "@codemirror/lsp-client";

import type { Expand } from "./popups.js";
import { codeLine, docsElement, hintFrame, titleOf } from "./popups.js";

type Markup = string | { readonly kind: string; readonly value: string };
type Parameter = {
  readonly label: string | readonly [number, number];
  readonly documentation?: Markup;
};
type Signature = {
  readonly label: string;
  readonly documentation?: Markup;
  readonly parameters?: readonly Parameter[];
  readonly activeParameter?: number;
};
/** LSP's SignatureHelp, the fields read here. */
export type Help = {
  readonly signatures: readonly Signature[];
  readonly activeSignature?: number;
  readonly activeParameter?: number;
};
/** The hints on screen: the answer, the signature chosen and where the tooltip stands. */
export type Shown = { readonly help: Help; readonly active: number; readonly pos: number };

const markdownOf = (value: Markup | undefined): string =>
  value === undefined ? "" : typeof value === "string" ? value : value.value;

/** The index of the parameter the caret is at, in the chosen signature. */
export const activeOf = (help: Help, active: number): number | undefined =>
  help.signatures[active]?.activeParameter ?? help.activeParameter;

/** The active parameter's range in the signature's label. */
function activeRange(signature: Signature, parameter: Parameter | undefined) {
  if (parameter === undefined) return undefined;
  if (typeof parameter.label !== "string") return [parameter.label[0], parameter.label[1]] as const;
  const at = signature.label.indexOf(parameter.label);
  return at === -1 ? undefined : ([at, at + parameter.label.length] as const);
}

/** The first line: the overload count when there are several, then the signature. */
function headOf(shown: Shown, signature: Signature, range: readonly [number, number] | undefined) {
  const head = document.createElement("div");
  head.className = "cm-nimboSignature";
  const total = shown.help.signatures.length;
  if (total > 1) {
    const count = document.createElement("span");
    count.className = "cm-lsp-signature-num";
    count.textContent = `${String(shown.active + 1)}/${String(total)}`;
    head.append(count);
  }
  head.append(codeLine(signature.label, range));
  return head;
}

/** The active parameter's text (`name` — text), then the function's documentation. */
function docsOf(
  plugin: LSPPlugin,
  signature: Signature,
  parameter: Parameter | undefined,
  range: readonly [number, number] | undefined,
): HTMLElement[] {
  const parts: HTMLElement[] = [];
  const own = markdownOf(parameter?.documentation);
  if (range !== undefined && own !== "") {
    const name = signature.label.slice(range[0], range[1]).split(/[?:]/u)[0] ?? "";
    parts.push(docsElement(plugin, `\`${name}\` — ${own}`));
  }
  const docs = markdownOf(signature.documentation);
  if (docs !== "") parts.push(docsElement(plugin, docs));
  return parts;
}

/** The hints' popup for `shown`; `expand` opens the whole of it in a dialog. */
export function drawSignature(view: EditorView, shown: Shown, expand: Expand | null): HTMLElement {
  const signature = shown.help.signatures[shown.active];
  if (signature === undefined) return document.createElement("div");
  const index = activeOf(shown.help, shown.active);
  const parameter = index === undefined ? undefined : signature.parameters?.[index];
  const range = activeRange(signature, parameter);
  const plugin = LSPPlugin.get(view);
  const parts = [
    headOf(shown, signature, range),
    ...(plugin === null ? [] : docsOf(plugin, signature, parameter, range)),
  ];
  const frame = hintFrame(parts, titleOf(signature.label), expand);
  // the page's Esc and the completion list's leave the editor alone while this is open (keyboard/useShortcuts.ts)
  frame.classList.add("cm-lsp-signature-tooltip");
  return frame;
}
