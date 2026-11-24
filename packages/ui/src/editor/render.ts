// Markdown as paper, loaded on first use by markdown.ts: a markdown cell's source rendered to HTML for the page with marked, GitHub
// flavoured, its JavaScript and TypeScript fences in the editor's colours (fences.ts), then sanitized with DOMPurify (an agent or a file may write any source, so nothing it holds may run:
// scripts, event handlers, forms and frames go). Links open in a new tab and never reach back to the page.
import { highlightCode, tagHighlighter } from "@lezer/highlight";
import DOMPurify from "dompurify";
import { Marked } from "marked";

import { fenceParser } from "./fences.js";
import { syntaxTokens } from "./syntax.js";

const escaped = (text: string): string =>
  text.replace(/[&<>"']/gu, (char) => `&#${String(char.charCodeAt(0))};`);

/** The editor's tokens as names a span carries in data-tok (class is never kept), painted by theme/prose.css. */
const tokens = tagHighlighter(syntaxTokens.map(({ tag, token }) => ({ tag, class: token })));

/** A fence's code as HTML: its JavaScript or TypeScript in spans of the editor's tokens, any other language as text;
 * its language said in data-lang, which the prose prints at its corner. */
export function fenceHtml(code: string, info: string): string {
  const parser = fenceParser(info);
  let html = "";
  if (parser === null) html = escaped(code);
  else
    highlightCode(
      code,
      parser.parse(code),
      tokens,
      (text, classes) => {
        html +=
          classes === "" ? escaped(text) : `<span data-tok="${classes}">${escaped(text)}</span>`;
      },
      () => {
        html += "\n";
      },
    );
  const language = info.trim().split(/\s+/u)[0] ?? "";
  const label = language === "" ? "" : ` data-lang="${escaped(language)}"`;
  return `<pre${label}><code>${html}</code></pre>\n`;
}

const marked = new Marked({
  gfm: true,
  breaks: false,
  async: false,
  renderer: { code: ({ text, lang }) => fenceHtml(text, lang ?? "") },
});

const forbidden = [
  "style",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "iframe",
  "object",
  "embed",
];

// Side effect: every link the prose holds opens in a new tab without an opener (installed once on the module's
// sanitizer, which only this file uses).
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A" && node.hasAttribute("href")) {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

/** The sanitized HTML of `source`. */
export function renderMarkdown(source: string): string {
  const html = marked.parse(source);
  return DOMPurify.sanitize(typeof html === "string" ? html : "", {
    FORBID_TAGS: forbidden,
    // no class or id either: the prose sits inside the page, whose ui: utilities a source must not borrow
    FORBID_ATTR: ["style", "class", "id"],
  });
}
