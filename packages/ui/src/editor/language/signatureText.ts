// TypeScript's display strings (a hover's or a completion's signature, a parameter hint's label) in the editor's
// syntax colours: `(method) Greeter.greet(times: number): string` is not a program a parser reads well, so a small
// lexer names each word by where it stands, as VS Code's TypeScript grammar does: a name before `(` is a function,
// before `:` a parameter or property, after `:` or `=>` a type; keywords, strings and numbers as in the editor.

/** A run of text and the syntax token (a page custom property without its dashes) that paints it, if any. */
export type Piece = { readonly text: string; readonly token?: string };

const keywords = new Set([
  "abstract",
  "as",
  "asserts",
  "async",
  "await",
  "class",
  "const",
  "declare",
  "default",
  "enum",
  "export",
  "extends",
  "function",
  "get",
  "implements",
  "import",
  "in",
  "infer",
  "interface",
  "is",
  "keyof",
  "let",
  "module",
  "namespace",
  "new",
  "of",
  "private",
  "protected",
  "public",
  "readonly",
  "set",
  "static",
  "type",
  "typeof",
  "unique",
  "var",
]);

/** The built-in types, painted as types (the editor paints `string` in a type position so). */
const primitives = new Set([
  "any",
  "bigint",
  "boolean",
  "never",
  "number",
  "object",
  "string",
  "symbol",
  "unknown",
  "void",
]);

const atoms = new Set(["true", "false", "null", "undefined", "this"]);

/** Words after which a type follows. */
const typeOpeners = new Set([
  ":",
  "?:",
  "=>",
  "|",
  "&",
  "extends",
  "implements",
  "keyof",
  "is",
  "as",
]);

const lexer =
  /\s+|"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`[^`]*`?|\d[\w.]*|[A-Za-z_$][\w$]*|=>|\?:|\?\.|\.\.\.|[^\s\w$]/gu;

const isName = (text: string): boolean => /^[A-Za-z_$]/u.test(text);

/** The token a name has wherever it stands: a keyword, or true, null, this… */
const fixedToken = (text: string): string | undefined =>
  keywords.has(text) ? "kw" : atoms.has(text) ? "bool" : undefined;

/** The token of a name from what is around it. */
function nameToken(text: string, next: string | undefined, inType: boolean): string | undefined {
  const fixed = fixedToken(text);
  if (fixed !== undefined) return fixed;
  if (next === ":" || next === "?:") return "key";
  if (primitives.has(text) || inType) return "typ";
  const capital = /^[A-Z]/u.test(text);
  if (next === "(" || (next === "<" && !capital)) return "fn";
  return capital ? "typ" : undefined;
}

/** The token of punctuation or a literal. */
function otherToken(text: string): string | undefined {
  if (/^["'`]/u.test(text)) return "str";
  if (/^\d/u.test(text)) return "num";
  if (text === "=>") return "kw";
  return /^\s/u.test(text) ? undefined : "punc";
}

/** The brackets that open a level, and whether a type is what starts inside it (`<` opens type arguments). */
const opens: ReadonlyMap<string, boolean> = new Map([
  ["(", false],
  ["{", false],
  ["[", false],
  ["<", true],
]);
const closes = new Set([")", "}", "]", ">"]);
const ends = new Set([",", ";", "="]);

/** Where a type starts and ends: after `:` or `=>`, until the `,`, `)`, `;` or `=` that closes it at its own depth. */
class TypeContext {
  private levels: { readonly outer: boolean; readonly inside: boolean }[] = [];
  inType = false;

  step(text: string): void {
    const inside = opens.get(text);
    if (typeOpeners.has(text)) this.inType = true;
    else if (inside !== undefined) {
      this.levels.push({ outer: this.inType, inside });
      this.inType = inside;
    } else if (closes.has(text)) this.inType = this.levels.pop()?.outer ?? false;
    else if (ends.has(text)) this.inType = this.levels.at(-1)?.inside ?? false;
  }
}

/** The display string as pieces; a leading `(method)`, `(property)`… is TypeScript's kind, painted muted. */
export function signaturePieces(source: string): Piece[] {
  const kind = /^\((?:[a-z]+ ?)+\) /u.exec(source)?.[0];
  const text = kind === undefined ? source : source.slice(kind.length);
  const words = text.match(lexer) ?? [];
  const solid = words.map((word, at) => ({ word, at })).filter(({ word }) => !/^\s/u.test(word));
  const nextOf = new Map(solid.map(({ at }, index) => [at, solid[index + 1]?.word]));
  const context = new TypeContext();
  const pieces: Piece[] = kind === undefined ? [] : [{ text: kind, token: "cmt" }];
  words.forEach((word, at) => {
    const token = isName(word) ? nameToken(word, nextOf.get(at), context.inType) : otherToken(word);
    pieces.push(token === undefined ? { text: word } : { text: word, token });
    if (!/^\s/u.test(word)) context.step(word);
  });
  return pieces;
}
