// Hover as VS Code shows TypeScript's: the signature in syntax colours, a thin line, then
// the documentation, in the popups' frame (popups.ts) with its expand button.
import { LSPPlugin } from "@codemirror/lsp-client";
import { hoverTooltip } from "@codemirror/view";

import type { Expand } from "./popups.js";
import { codeLine, docsElement, hintFrame, titleOf } from "./popups.js";

/** The signature a hover's markdown opens with (lspShapes.ts writes it in a `ts` fence), and the rest. */
function splitHover(value: string): { readonly signature: string | null; readonly docs: string } {
  const fence = /^```[a-z]*\n([\s\S]*?)\n```\s*/u.exec(value);
  return fence
    ? { signature: fence[1] ?? "", docs: value.slice(fence[0].length) }
    : { signature: null, docs: value };
}

type HoverResult = {
  readonly contents: string | { readonly value: string };
  readonly range?: {
    readonly start: { line: number; character: number };
    readonly end: { line: number; character: number };
  };
};

/** Hover as VS Code shows TypeScript's: the signature in syntax colours, a line, the documentation. */
export const hover = (expand: () => Expand | null) =>
  hoverTooltip(
    async (view, pos) => {
      const plugin = LSPPlugin.get(view);
      if (!plugin) return null;
      plugin.client.sync();
      const result = await plugin.client
        .request<unknown, HoverResult | null>("textDocument/hover", {
          position: plugin.toPosition(pos),
          textDocument: { uri: plugin.uri },
        })
        .catch(() => null);
      if (!result) return null;
      const value = typeof result.contents === "string" ? result.contents : result.contents.value;
      const { signature, docs } = splitHover(value);
      return {
        pos: result.range ? plugin.fromPosition(result.range.start) : pos,
        end: result.range ? plugin.fromPosition(result.range.end) : pos,
        above: true,
        create: () => {
          const parts = [
            ...(signature === null ? [] : [codeLine(signature)]),
            ...(docs.trim() === "" ? [] : [docsElement(plugin, docs)]),
          ];
          return { dom: hintFrame(parts, titleOf(signature ?? ""), expand()) };
        },
      };
    },
    { hideOn: (tr) => tr.docChanged },
  );
