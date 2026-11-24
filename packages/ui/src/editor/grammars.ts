// The editor's grammars, a chunk of their own that setup.ts loads on first use: JavaScript with
// TypeScript syntax for code cells, markdown with GitHub's extensions and its JavaScript fences in that grammar, from Lezer's own parser (@codemirror/lang-markdown
// would bring the HTML and CSS grammars along for the HTML blocks inside markdown).
import { javascript } from "@codemirror/lang-javascript";
import { defineLanguageFacet, Language } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { GFM, parseCode, parser } from "@lezer/markdown";

import { fenceParser } from "./fences.js";

// a fence of JavaScript or TypeScript is parsed with the code cells' grammar, so it takes their colours (fences.ts)
const markdown = new Language(
  defineLanguageFacet({ commentTokens: { block: { open: "<!--", close: "-->" } } }),
  parser.configure([GFM, parseCode({ codeParser: fenceParser })]),
  [],
  "markdown",
);

export const grammars: Readonly<Record<"code" | "markdown", Extension>> = {
  code: javascript({ typescript: true }),
  markdown,
};
