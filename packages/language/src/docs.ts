// TypeScript's documentation as the markdown the popups render, written as VS Code's
// TypeScript support writes it (its previewer, textRendering.ts): the text, then each JSDoc tag (`*@param* \`name\` —
// text`, `*@returns* — text`, `@example` as code), and `{@link}` / `{@linkcode}` as links: to the symbol's definition
// through `href` (a cell or a file, which the page follows as F12 does), or to the web address it names.
import ts from "typescript";

/** Where a link to a symbol's declaration goes, or undefined when it has no place the user can open. */
export type Href = (target: ts.DocumentSpan) => string | undefined;

/** Display parts as plain text: a signature, a parameter's label. */
export const plainParts = (list: readonly ts.SymbolDisplayPart[] | undefined): string =>
  ts.displayPartsToString(list ? [...list] : undefined);

const escapeCode = (text: string): string => text.replace(/`/gu, "\\`");

type Link = { code: boolean; name?: string; text?: string; target?: ts.DocumentSpan };

/** A link to a web address: `<address>` alone, or its words linked to it. */
function webLink(text: string, code: boolean): string {
  const [address = "", ...rest] = text.split(/\s+/u);
  if (rest.length === 0 && !code) return `<${address}>`;
  const label = rest.join(" ") || address;
  return `[${code ? `\`${escapeCode(label)}\`` : label}](${address})`;
}

/** One `{@link …}` as markdown: the symbol's place, a web address, or its words when it goes nowhere. */
function linkMarkdown(link: Link, href: Href): string {
  const words = (label: string) => (link.code ? `\`${escapeCode(label)}\`` : label);
  const label = link.text ?? link.name ?? "";
  if (link.target === undefined)
    return /^https?:/u.test(label.trim()) ? webLink(label.trim(), link.code) : words(label);
  const to = href(link.target);
  return to === undefined ? words(label) : `[${words(label)}](${to})`;
}

const isLinkPart = (part: ts.SymbolDisplayPart): part is ts.JSDocLinkDisplayPart =>
  "target" in part && part.target !== undefined;

/** Display parts as markdown, their `{@link}` parts as links (VS Code's convertLinkTags). */
export function linkedParts(
  list: readonly ts.SymbolDisplayPart[] | string | undefined,
  href: Href,
): string {
  if (list === undefined) return "";
  if (typeof list === "string") return list;
  const out: string[] = [];
  let link: Link | undefined;
  for (const part of list) {
    if (part.kind === "link") {
      // `{@link ` opens a link and `}` closes it
      if (link !== undefined) out.push(linkMarkdown(link, href));
      link = link === undefined ? { code: part.text === "{@linkcode " } : undefined;
    } else if (link !== undefined) fill(link, part, out);
    else out.push(part.text);
  }
  return out.join("");
}

/** A part inside an open link: its name (and the declaration it names), its words, or plain text. */
function fill(link: Link, part: ts.SymbolDisplayPart, out: string[]): void {
  if (part.kind === "linkName") {
    link.name = part.text;
    if (isLinkPart(part)) link.target = part.target;
  } else if (part.kind === "linkText") link.text = part.text;
  else out.push(part.text);
}

/** A tag's text in a code block, as VS Code shows `@example` and `@default`, unless it holds a fence already. */
const codeBlock = (text: string): string =>
  /^\s*[~`]{3}/mu.test(text) ? text : `\`\`\`ts\n${text}\n\`\`\``;

/** A body after its label: on the label's line after an em dash, or under it when it spans lines. */
const after = (label: string, body: string): string =>
  body === "" ? label : `${label}${/\r?\n/u.test(body) ? `  \n${body}` : ` — ${body}`}`;

/** `@param name - text` (and `@template`, `@extends`): the name in code, then the text. */
function namedTag(label: string, text: string): string {
  const [, name, body = ""] = /^(\S+)\s*-?\s*([\s\S]*)$/u.exec(text) ?? [];
  return name === undefined ? label : after(`${label} \`${name}\``, body);
}

/** `@example` as code, its `<caption>` first. */
function exampleTag(label: string, text: string): string {
  const caption = /^<caption>(.*?)<\/caption>\s*\r?\n/u.exec(text);
  const code = caption
    ? `${caption[1] ?? ""}\n${codeBlock(text.slice(caption[0].length))}`
    : codeBlock(text);
  return after(label, code);
}

const returnsTag = (label: string, text: string): string | undefined =>
  text === "" ? undefined : after(label, text);

/** How VS Code's TypeScript support writes each tag (its previewer); any other tag is its label, then its text. */
const tagWriters: Readonly<Record<string, (label: string, text: string) => string | undefined>> = {
  param: namedTag,
  template: namedTag,
  augments: namedTag,
  extends: namedTag,
  return: returnsTag,
  returns: returnsTag,
  example: exampleTag,
  default: (label, text) => after(label, codeBlock(text)),
};

/** One JSDoc tag; an `@example` keeps its code as written, links included. */
function tagMarkdown(tag: ts.JSDocTagInfo, href: Href): string | undefined {
  const text = tag.name === "example" ? plainParts(tag.text) : linkedParts(tag.text, href);
  return (tagWriters[tag.name] ?? after)(`*@${tag.name}*`, text);
}

/** The documentation and its JSDoc tags as markdown text, as VS Code renders TypeScript's (its previewer). */
export function documentation(
  docs: readonly ts.SymbolDisplayPart[] | undefined,
  tags: readonly ts.JSDocTagInfo[] | undefined,
  href: Href,
): string {
  const tagText = (tags ?? [])
    .map((tag) => tagMarkdown(tag, href))
    .filter((each): each is string => each !== undefined)
    .join("  \n\n");
  return [linkedParts(docs, href), tagText].filter((each) => each !== "").join("\n\n");
}
