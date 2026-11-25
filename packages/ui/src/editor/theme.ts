// The editor's look: a HighlightStyle that paints CodeMirror's tags with the page's syntax tokens and an editor theme
// on the cell's white, with quiet line numbers, the orange caret and a neutral band on the current line. Both read CSS custom properties, so the theme follows data-theme with
// no rebuild; the code size is --editor-size (editor.fontSize), --text-code by default. The extras of a cell's editor
// have their rules too: the brackets' three colours and the indent guides, the caret's scope, the find row under the
// header, the completion list under the caret and the values at the lines' ends. Every colour is a page token.
import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { hangRules } from "./marks.js";
import { syntaxTokens } from "./syntax.js";
import { languageRules, onDarkLayer } from "./languageTheme.js";

export const editorHighlight = HighlightStyle.define([
  ...syntaxTokens.map(({ tag, token }) => ({ tag, color: `var(--${token})` })),
  { tag: tags.heading, color: "var(--fg)", fontWeight: "600" },
  { tag: [tags.link, tags.url], color: "var(--client)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.monospace, color: "var(--str)" },
  { tag: tags.invalid, color: "var(--err)" },
]);

/** Brackets by depth, indent guides, the darker guide and the boxed pair of the scope holding the caret. */
const bracketRules = {
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
const findRowRules = {
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
const completionRules = {
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
const lineValueRules = {
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

/** The frame around the text: transparent on the cell's white, the orange caret, the selection and the active line. */
export const editorTheme = EditorView.theme({
  "&": {
    backgroundColor: "transparent",
    color: "var(--fg)",
    fontSize: "var(--editor-size, var(--text-code))",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.3rem", overflow: "visible" },
  // the card's ring and the caret say the editor has the focus, not the page's focus ring as well
  ".cm-content": { padding: "0", caretColor: "var(--fill)", boxShadow: "none" },
  ".cm-line": { padding: "0" },
  // line numbers end under the cell number of the header row; the code starts on the cell's text edge
  ".cm-gutters": {
    backgroundColor: "transparent",
    color: "var(--faint)",
    border: "none",
    fontSize: "0.75rem",
    inlineSize: "var(--cell-gutter)",
    marginInlineEnd: "1rem",
  },
  ".cm-lineNumbers": { flex: "1" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0", minInlineSize: "100%" },
  ".cm-activeLineGutter": { backgroundColor: "transparent" },
  // the line the last run failed at: its number in red on a red tint that runs on into the gap before the code
  ".cm-lineNumbers .cm-gutterElement.cm-failedLine": {
    color: "var(--err)",
    fontWeight: "500",
    backgroundImage: "linear-gradient(90deg, transparent 1.5rem, var(--err-soft) 1.5rem)",
    boxShadow: "0.5rem 0 0 var(--err-soft)",
  },
  // the lines an agent changed that no one reviewed: a thin violet bar at the gutter's outer edge, as VS Code marks changed
  // lines, and the number in violet; no tint, so the code reads as code
  ".cm-lineNumbers .cm-gutterElement.cm-agentLine": {
    color: "var(--agent)",
    boxShadow: "inset 0.1875rem 0 0 var(--agent)",
    cursor: "default",
  },
  // ringed while the cell's button for the edit has the keyboard's focus (cells/AgentMarks.vue)
  ".cm-lineNumbers .cm-gutterElement.cm-agentLine.cm-agentFocus": {
    outline: "2px solid var(--agent)",
    outlineOffset: "-2px",
  },
  "&.cm-focused .cm-activeLineGutter": { backgroundColor: "var(--line)", color: "var(--fg)" },
  ".cm-cursor, .cm-dropCursor": {
    borderInlineStartColor: "var(--fill)",
    borderInlineStartWidth: "2px",
  },
  // the selection tints the selected text alone (marks.ts textSelection), so CodeMirror's own layer, which runs a
  // selected line out to the right edge, stays transparent; a selected line break is a half-character at the line's end
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground":
    { backgroundColor: "transparent" },
  ".cm-textSelection, .cm-lineBreakSelection": { backgroundColor: "var(--sel)" },
  ".cm-lineBreakSelection": { inlineSize: "0.5ch" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  // translucent: CodeMirror paints the selection on a layer under the lines, which an opaque active line hid (testing
  // note 6); the editor gets no stacking context of its own, or its tooltips (completions) would fall under the next card
  // --line is translucent in both palettes, and the same band as the active line's gutter
  "&.cm-focused .cm-activeLine": { backgroundColor: "var(--line)" },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--well)",
    outline: "1px solid var(--guide-on)",
  },
  ".cm-searchMatch": { backgroundColor: "var(--match)" },
  // the other places the selected word appears: the find match's tone, never CodeMirror's own green
  ".cm-selectionMatch": { backgroundColor: "var(--match)" },
  // the match the find row stands on: the warm selection with a hairline, never orange (the caret's and Run all's)
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "var(--sel)",
    boxShadow: "0 0 0 1px var(--guide-on)",
  },
  ...bracketRules,
  ...findRowRules,
  ...completionRules,
  ...languageRules,
  ...lineValueRules,
  ".cm-tooltip": {
    backgroundColor: "var(--pop)",
    color: "var(--pop-fg)",
    border: "none",
    borderRadius: "var(--radius-control)",
    boxShadow: "var(--shadow-pop)",
  },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "color-mix(in oklch, var(--pop-fg) 14%, transparent)",
    color: "var(--pop-fg)",
  },
  ...hangRules,
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--err)",
    textUnderlineOffset: "0.2em",
  },
});
