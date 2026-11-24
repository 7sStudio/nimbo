// The text of contains and startsWith chips as an I-Regexp (RFC 9485) for search(), and back.

/** Characters that mean something in a pattern; each is written with a backslash. */
const special = new Set(["\\", ".", "?", "*", "+", "{", "}", "(", ")", "|", "[", "]", "^"]);

/** `$` has no I-Regexp escape, and the JavaScript engine under search() reads it as an anchor. */
const dollar = "[$]";

/** A pattern that matches `text` literally. */
export const escapeLiteral = (text: string): string =>
  Array.from(text, (ch) => (ch === "$" ? dollar : special.has(ch) ? `\\${ch}` : ch)).join("");

/** The text a pattern made by escapeLiteral matches; undefined for any other pattern. */
export const unescapeLiteral = (pattern: string): string | undefined => {
  let text = "";
  let index = 0;
  while (index < pattern.length) {
    const ch = pattern.charAt(index);
    const next = pattern.charAt(index + 1);
    if (pattern.startsWith(dollar, index)) {
      text += "$";
      index += dollar.length;
    } else if (ch === "\\" && special.has(next)) {
      text += next;
      index += 2;
    } else if (special.has(ch) || ch === "$") {
      return undefined;
    } else {
      text += ch;
      index += 1;
    }
  }
  return text;
};
