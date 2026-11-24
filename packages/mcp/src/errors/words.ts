// How a message names a CLI command for the agent to give the user (or run outside MCP): `nimbo` and its words, each
// word as a POSIX shell reads it whole, so a notebook path with a space or a `#` stays one argument.

/** A word as a POSIX shell reads it whole: left as it is when plain, else in single quotes. */
export const shellWord = (word: string): string =>
  /^[\w./:=@%+,-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;

/** `nimbo <words…>`, each word shell-quoted. */
export const jsnb = (...words: readonly string[]): string =>
  ["nimbo", ...words.map(shellWord)].join(" ");
