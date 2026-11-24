// jq's stderr as a QueryError: compile errors become syntax errors with a position, everything else a runtime error.
import type { QueryError } from "../errors.ts";

const compileTrailer = /\njq: \d+ compile errors?$/;
const located = /^jq: error: (.+) at <top-level>, line (\d+), column (\d+):$/;
const runtimePrefix = /^jq: error \(at [^)]*\)(?: \(not a string\))?: /;

const utf8Length = (codePoint: number): number =>
  codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;

/** The UTF-16 index in `line` of the character that holds UTF-8 byte `byte` (jq counts columns in bytes). */
const indexOfByte = (line: string, byte: number): number => {
  let bytes = 0;
  let index = 0;
  for (const ch of line) {
    if (bytes >= byte) return index;
    bytes += utf8Length(ch.codePointAt(0) ?? 0);
    index += ch.length;
  }
  return index;
};

/** The offset in `program` of jq's 1-based line and 1-based byte column. */
const offsetOf = (program: string, line: number, column: number): number => {
  const lines = program.split("\n");
  const before = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0);
  return Math.min(before + indexOfByte(lines[line - 1] ?? "", column - 1), program.length);
};

const compileError = (stderr: string, program: string): QueryError => {
  const first = stderr.split("\n")[0] ?? "";
  const match = located.exec(first);
  if (match === null) {
    const what = first.replace(/^jq: error: /, "");
    return {
      kind: "syntax",
      message: `The jq program does not compile: ${what}. Fix the program and run it again.`,
    };
  }
  const [, what = "", line = "1", column = "1"] = match;
  return {
    kind: "syntax",
    message: `The jq program does not compile: ${what} at line ${line}, column ${column}. Fix the program at the marked position.`,
    position: offsetOf(program, Number(line), Number(column)),
  };
};

/** The QueryError for a failed jq run, from its stderr; `halt_error` text is kept exactly as the program wrote it. */
export const jqErrorOf = (stderr: string, program: string): QueryError => {
  if (compileTrailer.test(stderr)) return compileError(stderr, program);
  const runtime = runtimePrefix.exec(stderr);
  if (runtime !== null || stderr.startsWith("jq: ")) {
    const detail = stderr.slice(runtime === null ? 4 : runtime[0].length);
    return {
      kind: "runtime",
      message: `The jq program failed on this value: ${detail}. Check the program against the value's shape; ? and // skip the parts that may be missing.`,
    };
  }
  return { kind: "runtime", message: stderr };
};
