// The language service's look in the editor, beside the completion list's rules.
import type { ColorName } from "@jsnb/tokens";
import { colors } from "@jsnb/tokens";

/** A color's dark-theme value, an alias's from the color it names. */
const darkOf = (name: ColorName): string => {
  const color = colors[name];
  return "of" in color ? darkOf(color.of) : `oklch(${color.dark.oklch})`;
};

/** The syntax tokens and the accent a popup paints with, at their dark values: the floating layer (--pop) is dark in
 * both themes, and the light values would not read on it. A syntax theme puts its own dark side in --<token>-pop
 * (theme/syntaxTheme.ts); the palette's own is the fallback. */
export const onDarkLayer: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    (["kw", "ctl", "str", "num", "bool", "typ", "fn", "key", "cmt", "punc"] as const).map(
      (name) => [`--${name}`, `var(--${name}-pop, ${darkOf(name)})`],
    ),
  ),
  "--client": darkOf("client"),
};

/** The language service's popups (popups.ts): hover, the completion's details pane and the parameter hints in
 * one frame, as VS Code draws them, and the rename dialog, on the floating layer's dark like the completion list. */
export const languageRules = {
  // the floating layer is dark in both themes, so the popup's code takes the dark theme's syntax colours
  ".cm-nimboHint": { position: "relative", maxInlineSize: "36rem", ...onDarkLayer },
  ".cm-nimboHintBody": {
    maxBlockSize: "min(20rem, 50vh)",
    overflowY: "auto",
    // the completion's details pane keeps the newlines of its text (pre-line): markdown's are not text
    whiteSpace: "normal",
    paddingBlock: "0.375rem",
    paddingInline: "0.625rem",
    fontFamily: "var(--font)",
    fontSize: "0.75rem",
    lineHeight: "1.45",
  },
  ".cm-nimboHint[data-overflow] .cm-nimboHintBody": { paddingInlineEnd: "1.75rem" },
  ".cm-nimboHintPart": {
    marginBlockStart: "0.375rem",
    paddingBlockStart: "0.375rem",
    borderBlockStart: "1px solid color-mix(in oklch, var(--pop-fg) 16%, transparent)",
  },
  ".cm-nimboCode": {
    fontFamily: "var(--mono)",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  ".cm-nimboSignature": { display: "flex", alignItems: "baseline", gap: "0.5rem" },
  ".cm-nimboHint .cm-lsp-signature-num": {
    position: "static",
    color: "var(--pop-muted)",
    fontFamily: "var(--mono)",
    fontSize: "inherit",
    lineHeight: "inherit",
    flex: "none",
  },
  ".cm-lsp-active-parameter": { color: "var(--client)", fontWeight: "600" },
  ".cm-nimboExpand": {
    position: "absolute",
    insetBlockStart: "0.25rem",
    insetInlineEnd: "0.25rem",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    blockSize: "1.25rem",
    inlineSize: "1.25rem",
    padding: "0",
    border: "none",
    borderRadius: "var(--radius-small, 0.25rem)",
    backgroundColor: "transparent",
    color: "var(--pop-muted)",
    cursor: "pointer",
  },
  ".cm-nimboHint[data-overflow] .cm-nimboExpand": { display: "inline-flex" },
  ".cm-nimboExpand:hover": {
    color: "var(--pop-fg)",
    backgroundColor: "color-mix(in oklch, var(--pop-fg) 14%, transparent)",
  },
  ".cm-nimboExpand svg": {
    blockSize: "0.875rem",
    inlineSize: "0.875rem",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  // the library's own look for these classes (padding, a scrolled height, a smaller font) gives way to the frame's
  // the parameter hints' frame is the tooltip itself (CodeMirror adds cm-tooltip to the element it is given)
  ".cm-nimboHint.cm-lsp-signature-tooltip": {
    padding: "0",
    maxHeight: "none",
    maxWidth: "36rem",
    overflowY: "visible",
    borderRadius: "0",
  },
  ".cm-tooltip .cm-lsp-documentation, .cm-tooltip .cm-nimboHint .cm-lsp-documentation": {
    padding: "0",
    fontSize: "inherit",
  },
  ".cm-tooltip .cm-lsp-documentation p, .cm-tooltip .cm-lsp-documentation pre": {
    marginBlock: "0.25rem",
  },
  ".cm-tooltip .cm-lsp-documentation p:first-child": { marginBlockStart: "0" },
  ".cm-tooltip .cm-lsp-documentation p:last-child": { marginBlockEnd: "0" },
  ".cm-tooltip .cm-lsp-documentation code": {
    fontFamily: "var(--mono)",
    fontSize: "0.95em",
    paddingInline: "0.3em",
    borderRadius: "0.1875rem",
    backgroundColor: "color-mix(in oklch, var(--pop-fg) 10%, transparent)",
  },
  ".cm-tooltip .cm-lsp-documentation pre": {
    paddingBlock: "0.375rem",
    paddingInline: "0.5rem",
    borderRadius: "0.25rem",
    backgroundColor: "color-mix(in oklch, var(--pop-fg) 6%, transparent)",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  ".cm-tooltip .cm-lsp-documentation pre code": { padding: "0", backgroundColor: "transparent" },
  ".cm-tooltip .cm-lsp-documentation a": { color: "var(--client)" },
  ".cm-tooltip .cm-lsp-documentation em": { color: "var(--pop-muted)" },
  // the completion list's details pane: the frame pads it
  ".cm-tooltip.cm-completionInfo": { padding: "0", maxInlineSize: "28rem" },
  ".cm-nimboRename": {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.25rem 0.5rem",
  },
  ".cm-nimboRename input": {
    blockSize: "1.375rem",
    minInlineSize: "12rem",
    paddingInline: "0.5rem",
    border: "1px solid transparent",
    borderRadius: "var(--radius-control)",
    backgroundColor: "var(--code)",
    color: "var(--fg)",
    fontFamily: "var(--mono)",
    fontSize: "0.75rem",
    outline: "none",
  },
  ".cm-nimboRename input:focus-visible": { borderColor: "var(--accent)" },
};
