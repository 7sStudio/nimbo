// The Raw view's text ("@lezer/highlight with @codemirror/lang-json"): pretty JSON split in lines
// of syntax tokens with the same token names as the tree, cut at 256 KB so a 4 MB value still opens at once.
import { jsonLanguage } from "@codemirror/lang-json";
import { highlightCode, tagHighlighter, tags } from "@lezer/highlight";

import type { Token, TokenKind } from "../model/leaf.js";
import { withStarts } from "./marks.js";

/** Characters of the Raw view highlighted and shown; the rest is one "copy or export" away. */
export const rawLimit = 256 * 1024;

const highlighter = tagHighlighter([
  { tag: tags.propertyName, class: "key" },
  { tag: tags.string, class: "str" },
  { tag: tags.number, class: "num" },
  { tag: tags.bool, class: "bool" },
  { tag: tags.null, class: "nul" },
  { tag: [tags.separator, tags.brace, tags.squareBracket], class: "punc" },
]);

const kinds: Readonly<Partial<Record<string, TokenKind>>> = {
  key: "key",
  str: "str",
  num: "num",
  bool: "bool",
  nul: "nul",
  punc: "punc",
};

/** A line of the Raw view: its tokens, each with its offset in the line, and the line's own offset in the text (the
 * stable keys of the view's v-fors, 08 §7). */
export type RawLine = {
  readonly start: number;
  readonly tokens: readonly (Token & { readonly start: number })[];
};

/** JSON text as lines of tokens; text that is not JSON (a repr) comes back as plain lines. */
export function rawLines(text: string, json: boolean): RawLine[] {
  const shown = text.length > rawLimit ? text.slice(0, rawLimit) : text;
  const split = json
    ? tokenLines(shown)
    : shown.split("\n").map((line): Token[] => [{ kind: "text", text: line }]);
  let at = 0;
  return split.map((tokens) => {
    const line = { start: at, tokens: withStarts(tokens) };
    at += tokens.reduce((sum, token) => sum + token.text.length, 0) + 1;
    return line;
  });
}

function tokenLines(shown: string): Token[][] {
  const lines: Token[][] = [[]];
  highlightCode(
    shown,
    jsonLanguage.parser.parse(shown),
    highlighter,
    (code, classes) => {
      lines[lines.length - 1]?.push({ kind: kinds[classes] ?? "text", text: code });
    },
    () => {
      lines.push([]);
    },
  );
  return lines;
}
