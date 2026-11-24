// The query input's four small grammars (11-query §4: "syntax highlighting per mode"), as CodeMirror stream parsers,
// and the highlight style that paints their tokens with the viewer's colors (does the same for the editor).
import type { QueryMode } from "@jsnb/core";
import type { StreamParser, StringStream } from "@codemirror/language";
import { HighlightStyle, StreamLanguage } from "@codemirror/language";
import { tags } from "@lezer/highlight";

const words = (list: string): ReadonlySet<string> => new Set(list.split(" "));

const jqWords = words(
  "and or not if then elif else end as def reduce foreach try catch label import include select map length keys values has in to_entries from_entries with_entries group_by sort_by unique_by min_by max_by add any all flatten range floor sqrt tostring tonumber type empty error first last limit until while recurse env input inputs splits sub gsub test match capture ascii_downcase ascii_upcase ltrimstr rtrimstr startswith endswith join split",
);
const sqlWords = words(
  "select from where group by order limit offset as and or not in is null like ilike between distinct having join left right inner outer full cross on using union all case when then else end asc desc count sum avg min max with cast true false exists unnest struct list",
);
const filterOps = words("contains startsWith exists matches");

/** Strings, numbers, true/false/null: the tokens every mode shares. */
function literal(stream: StringStream): string | null {
  if (stream.match(/^'(?:[^'\\]|\\.)*'?/) || stream.match(/^"(?:[^"\\]|\\.)*"?/)) return "string";
  if (stream.match(/^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/)) return "number";
  if (stream.match(/^(?:true|false|null)\b/)) return "atom";
  return null;
}

const parser = (rest: (stream: StringStream) => string | null): StreamParser<unknown> => ({
  token: (stream) => {
    if (stream.eatSpace()) return null;
    const token = literal(stream) ?? rest(stream);
    if (token === null) stream.next();
    return token;
  },
});

function word(stream: StringStream, keywords: ReadonlySet<string>, other: string): string | null {
  const match = stream.match(/^[A-Za-z_][\w]*/);
  if (!Array.isArray(match)) return null;
  return keywords.has(match[0].toLowerCase()) || keywords.has(match[0]) ? "keyword" : other;
}

const operator = (stream: StringStream, pattern: RegExp): string | null =>
  stream.match(pattern) ? "operator" : null;

const grammars: Readonly<Record<QueryMode, StreamParser<unknown>>> = {
  jsonpath: parser(
    (s) =>
      (s.match(/^[$@]/) ? "variableName" : null) ??
      operator(s, /^(?:==|!=|<=|>=|&&|\|\||[<>!?*])/) ??
      word(s, words("length count match search value"), "propertyName"),
  ),
  jq: parser(
    (s) =>
      (s.match(/^\$[A-Za-z_]\w*/) ? "variableName" : null) ??
      (s.match(/^\.[A-Za-z_]\w*/) ? "propertyName" : null) ??
      operator(s, /^(?:\|=|\/\/|==|!=|<=|>=|[|+\-*/%<>=?])/) ??
      word(s, jqWords, "variableName"),
  ),
  sql: parser(
    (s) => operator(s, /^(?:<>|!=|<=|>=|\|\||::|[=<>+\-*/%])/) ?? word(s, sqlWords, "propertyName"),
  ),
  filter: parser((s) => operator(s, /^(?:!=|>=|<=|[=<>])/) ?? word(s, filterOps, "propertyName")),
};

/** The language of a mode's input. */
export const queryLanguage = (mode: QueryMode): StreamLanguage<unknown> =>
  StreamLanguage.define(grammars[mode]);

/** Keywords for autocompletion (SQL and jq). */
export const keywordsOf = (mode: QueryMode): readonly string[] =>
  mode === "sql" ? [...sqlWords].map((w) => w.toUpperCase()) : mode === "jq" ? [...jqWords] : [];

/** The viewer's token colors for the query input. */
export const queryHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--bool)" },
  { tag: tags.string, color: "var(--str)" },
  { tag: tags.number, color: "var(--num)" },
  { tag: tags.atom, color: "var(--bool)" },
  { tag: tags.operator, color: "var(--fn)" },
  { tag: tags.propertyName, color: "var(--key)" },
  { tag: tags.variableName, color: "var(--typ)" },
]);
