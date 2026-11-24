// The syntax colours by Lezer tag, held once for the cell editor (theme.ts) and for the fenced code a rendered markdown
// cell shows (render.ts): each tag group names the page token that paints it (--kw, --str, …). Only @lezer/highlight
// here, so the markdown renderer's chunk takes no editor along.
import type { Tag } from "@lezer/highlight";
import { tags } from "@lezer/highlight";

/** A group of tags and the token (a custom property without its dashes) that paints them. */
export type SyntaxToken = { readonly tag: Tag | readonly Tag[]; readonly token: string };

export const syntaxTokens: readonly SyntaxToken[] = [
  {
    tag: [tags.keyword, tags.modifier, tags.definitionKeyword, tags.operatorKeyword],
    token: "kw",
  },
  { tag: [tags.controlKeyword, tags.moduleKeyword], token: "ctl" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], token: "str" },
  { tag: tags.number, token: "num" },
  { tag: [tags.bool, tags.null, tags.atom], token: "bool" },
  { tag: [tags.typeName, tags.className, tags.namespace], token: "typ" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], token: "fn" },
  { tag: [tags.propertyName, tags.attributeName], token: "key" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], token: "cmt" },
  { tag: [tags.punctuation, tags.bracket, tags.separator], token: "punc" },
];
