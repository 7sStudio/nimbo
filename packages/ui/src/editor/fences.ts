// Fenced code inside markdown: a fence whose info string names
// JavaScript or TypeScript (js, javascript, mjs, cjs, jsx, ts, typescript, tsx, json) is parsed with the cell editor's
// own grammar, so its code takes the editor's colours, in the markdown editor (a nested parse, grammars.ts) and in the
// rendered prose (render.ts). Any other fence stays plain text.
import { typescriptLanguage } from "@codemirror/lang-javascript";

const scripts = new Set([
  "js",
  "javascript",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "typescript",
  "tsx",
  "json",
]);

/** The grammar of a fence's info string ("ts", "js title=x"), or null for one the editor does not know. */
export function fenceParser(info: string): typeof typescriptLanguage.parser | null {
  const language = info.trim().split(/\s+/u)[0]?.toLowerCase() ?? "";
  return scripts.has(language) ? typescriptLanguage.parser : null;
}
