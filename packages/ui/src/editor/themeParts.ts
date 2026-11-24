// The editor theme's rules for the extras of a cell's editor, spread into
// theme.ts: the brackets' three colours and the indent guides, the caret's scope, the find row under the header, the
// completion list under the caret and the values at the lines' ends. Every colour is a page token.
import { onDarkLayer } from "./languageTheme.js";

/** Brackets by depth, indent guides, the darker guide and the boxed pair of the scope holding the caret. */
export const bracketRules = {
  ".cm-bracket-1, .cm-bracket-1 span": { color: "var(--bracket-1)" },
  ".cm-bracket-2, .cm-bracket-2 span": { color: "var(--bracket-2)" },
  ".cm-bracket-3, .cm-bracket-3 span": { color: "var(--bracket-3)" },
  ".cm-guide": { boxShadow: "inset 1px 0 0 var(--guide)" },
  "&.cm-focused .cm-guide-on": { boxShadow: "inset 1px 0 0 var(--guide-on)" },
  "&.cm-focused .cm-scopeBracket": {
    backgroundColor: "var(--well)",
    boxShadow: "0 0 0 1px var(--guide-on)",
    borderRadius: "1px",
  },
};

const findControl = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.25rem",
  blockSize: "1.375rem",
  paddingInline: "0.5rem",
  border: "1px solid transparent",
  borderRadius: "var(--radius-control)",
  backgroundColor: "transparent",
  color: "var(--fg-2)",
  font: "inherit",
  fontWeight: "500",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

/** The find row: on the header's tone under the header, its field and buttons on the code's white. */
export const findRowRules = {
  ".cm-panels": { backgroundColor: "var(--head)", color: "var(--fg)", border: "none" },
  ".cm-panels.cm-panels-top": {
    marginBlockStart: "-0.4375rem",
    marginBlockEnd: "0.4375rem",
    marginInlineEnd: "-1rem",
    position: "static",
    border: "none",
  },
  // on a narrow cell the fields give up width first, then the row wraps rather than run past the cell's edge
  ".cm-findRow": {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.25rem 0.375rem",
    minBlockSize: "1.875rem",
    paddingBlock: "0.25rem",
    paddingInlineEnd: "0.625rem",
    color: "var(--fg-2)",
    fontFamily: "var(--font)",
    fontSize: "0.6875rem",
  },
  ".cm-findRow > .cm-findIcon": {
    inlineSize: "0.8125rem",
    blockSize: "0.8125rem",
    marginInlineStart: "2rem",
    marginInlineEnd: "1.4375rem",
    flexShrink: "0",
    fill: "none",
    stroke: "var(--muted)",
    strokeWidth: "2",
  },
  ".cm-findField": {
    blockSize: "1.375rem",
    // wide enough for "Replace with" at 1512 px with both side panels open
    flex: "1 1 5.75rem",
    minInlineSize: "5.75rem",
    maxInlineSize: "11rem",
    paddingInline: "0.5rem",
    border: "1px solid transparent",
    borderRadius: "var(--radius-control)",
    backgroundColor: "var(--code)",
    color: "var(--fg)",
    fontFamily: "var(--mono)",
    fontSize: "0.75rem",
    caretColor: "var(--fill)",
    outline: "none",
  },
  ".cm-findField::placeholder": { color: "var(--muted)", fontFamily: "var(--font)" },
  ".cm-findField:focus-visible, .cm-findButton:focus-visible": { borderColor: "var(--accent)" },
  ".cm-findCount": {
    color: "var(--fg)",
    fontWeight: "500",
    paddingInline: "0.375rem 0.25rem",
    whiteSpace: "nowrap",
  },
  ".cm-findButton": { ...findControl, backgroundColor: "var(--code)", color: "var(--fg)" },
  ".cm-findButton:hover": { backgroundColor: "var(--well)" },
  ".cm-findButton .cm-findIcon": {
    inlineSize: "0.75rem",
    blockSize: "0.75rem",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
  },
  ".cm-findButton kbd": {
    font: "inherit",
    fontWeight: "400",
    color: "var(--muted)",
    marginInlineStart: "0.25rem",
  },
  ".cm-findToggles": { display: "inline-flex", marginInlineStart: "0.25rem" },
  ".cm-findToggles .cm-findButton": { ...findControl, paddingInline: "0.25rem" },
  ".cm-findToggles .cm-findButton[aria-pressed='true']": {
    backgroundColor: "var(--code)",
    color: "var(--fg)",
  },
};

/** The completion list: under the caret, square, the floating layer's dark, a kind icon at each row's start and the
 * typed letters in the accent, as VS Code's suggest widget. */
export const completionRules = {
  ".cm-tooltip.cm-nimboComplete": { borderRadius: "0", padding: "0.25rem" },
  ".cm-tooltip.cm-nimboComplete > ul": {
    ...onDarkLayer,
    fontFamily: "var(--mono)",
    fontSize: "0.75rem",
    minInlineSize: "16rem",
    maxBlockSize: "12rem",
  },
  ".cm-tooltip.cm-nimboComplete > ul > li": {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    paddingBlock: "0.1875rem",
    paddingInline: "0.5rem",
    lineHeight: "1.3",
  },
  ".cm-tooltip.cm-nimboComplete > ul > li[aria-selected]": {
    backgroundColor: "color-mix(in oklch, var(--pop-fg) 14%, transparent)",
    color: "var(--pop-fg)",
    fontWeight: "500",
  },

  ".cm-tooltip.cm-nimboComplete .cm-completionMatchedText": {
    textDecoration: "none",
    fontWeight: "600",
    color: "var(--client)",
  },
  // the row's signature is in the details pane beside the list, as VS Code has it
  ".cm-tooltip.cm-nimboComplete .cm-completionDetail": { display: "none" },
  ".cm-tooltip.cm-nimboComplete .cm-nimboKind": {
    flex: "none",
    blockSize: "0.875rem",
    inlineSize: "0.875rem",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
};

/** A value at a line's end: quiet grey after the code, a small arrow before it, out of the flow so it never moves the
 * code; each name a button, cut with an ellipsis to the room the editor measures. */
export const lineValueRules = {
  ".cm-lineValue": {
    position: "absolute",
    display: "inline-flex",
    alignItems: "center",
    marginInlineStart: "2rem",
    fontSize: "0.75rem",
    lineHeight: "inherit",
    color: "var(--muted)",
    whiteSpace: "pre",
    textIndent: "0",
    userSelect: "none",
    overflow: "hidden",
  },
  ".cm-lineValue[data-measured='false'], .cm-lineValue[data-hidden]": { visibility: "hidden" },
  ".cm-lineValue svg": {
    flex: "none",
    marginInlineEnd: "0.375rem",
    inlineSize: "0.6875rem",
    blockSize: "0.6875rem",
    fill: "none",
    stroke: "var(--faint)",
    strokeWidth: "2",
  },
  ".cm-lineValue-part": {
    display: "inline-flex",
    minInlineSize: "0",
    flex: "none",
    overflow: "hidden",
  },
  ".cm-lineValue-part[hidden]": { display: "none" },
  ".cm-lineValue-item": {
    minInlineSize: "0",
    flex: "0 1 auto",
    overflow: "hidden",
    textOverflow: "ellipsis",
    padding: "0 0.25rem",
    marginInline: "-0.25rem",
    border: "1px solid transparent",
    borderRadius: "var(--radius-control)",
    backgroundColor: "transparent",
    color: "inherit",
    font: "inherit",
    cursor: "pointer",
  },
  ".cm-lineValue-item:hover": { color: "var(--fg)", backgroundColor: "var(--well)" },
  ".cm-lineValue-item:focus-visible": { outline: "none", borderColor: "var(--fg-2)" },
};
