// Find's query: a case-insensitive substring, or `/re/flags` for a regular expression.

/** Where a match lies in a key's or a value's text: [start, end) in UTF-16 units. */
export type TextRange = readonly [number, number];

/** A compiled query; `numeric` says whether a number's text could match, so the walk can skip numbers without text. */
export type Matcher = {
  readonly test: (text: string) => boolean;
  readonly ranges: (text: string) => TextRange[];
  readonly numeric: boolean;
};

export type MatcherError = { readonly message: string; readonly position: number };

export type MatcherResult =
  | { readonly ok: true; readonly value: Matcher }
  | { readonly ok: false; readonly error: MatcherError };

const regexLiteral = /^\/(.+)\/([a-z]*)$/s;
const syntax = /[.*+?^${}()|[\]\\]/g;
/** The characters of a finite number's text (special numbers are markers with text of their own). */
const numberText = /^[0-9.e+-]+$/i;
const maxRanges = 100;

function compiled(pattern: RegExp, numeric: boolean): Matcher {
  const test = (text: string): boolean => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  };
  const ranges = (text: string): TextRange[] => {
    const found: TextRange[] = [];
    pattern.lastIndex = 0;
    for (
      let match = pattern.exec(text);
      match && found.length < maxRanges;
      match = pattern.exec(text)
    ) {
      found.push([match.index, match.index + match[0].length]);
      if (match[0] === "") pattern.lastIndex += 1;
    }
    return found;
  };
  return { test, ranges, numeric };
}

function regexMatcher(source: string, flags: string): MatcherResult {
  const unknown = flags.replace(/[gimsuvyd]/g, "");
  if (unknown !== "") {
    return {
      ok: false,
      error: {
        message: `Unknown regular expression flag "${unknown.charAt(0)}"; use i, m, s, u or v.`,
        position: source.length + 2,
      },
    };
  }
  try {
    return {
      ok: true,
      value: compiled(new RegExp(source, `${flags.replace(/[gyd]/g, "")}g`), true),
    };
  } catch (error) {
    // An invalid pattern is the user's typo, not a crash: the find box shows the engine's message.
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: { message: `Invalid regular expression: ${message}`, position: 1 } };
  }
}

/** Compiles a find query: `/re/flags` is a regular expression, anything else a case-insensitive substring. */
export function matcherOf(query: string): MatcherResult {
  const literal = regexLiteral.exec(query);
  if (literal) return regexMatcher(literal[1] ?? "", literal[2] ?? "");
  const pattern = new RegExp(query.replace(syntax, "\\$&"), "giu");
  return { ok: true, value: compiled(pattern, numberText.test(query)) };
}
