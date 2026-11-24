// The editor's look: a HighlightStyle that paints CodeMirror's tags with the page's syntax tokens and an editor theme
// on the cell's white, with quiet line numbers, the orange caret and a neutral band on the current line. Both read CSS custom properties, so the theme follows data-theme with
// no rebuild; the code size is --editor-size (editor.fontSize), --text-code by default.
import { HighlightStyle } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

import { hangRules } from "./marks.js";
import { syntaxTokens } from "./syntax.js";
import { bracketRules, completionRules, findRowRules, lineValueRules } from "./themeParts.js";
import { languageRules } from "./languageTheme.js";

export const editorHighlight = HighlightStyle.define([
  ...syntaxTokens.map(({ tag, token }) => ({ tag, color: `var(--${token})` })),
  { tag: tags.heading, color: "var(--fg)", fontWeight: "600" },
  { tag: [tags.link, tags.url], color: "var(--client)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strong, fontWeight: "600" },
  { tag: tags.monospace, color: "var(--str)" },
  { tag: tags.invalid, color: "var(--err)" },
]);

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
