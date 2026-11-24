// Tests of jq/errors.ts: jq's stderr turned into QueryErrors, with positions in the program.
import { describe, expect, it } from "vitest";

import { jqErrorOf } from "./errors.ts";

const compile = (line: string, caret: string, program: string, count = 1) =>
  `jq: error: ${line}\n    ${program}\n    ${caret}\njq: ${String(count)} compile error${count > 1 ? "s" : ""}`;

describe("jqErrorOf on compile errors", () => {
  it("turns the first located compile error into a syntax error at its offset", () => {
    const program = "1 | {a: } | {b: }";
    const stderr = compile(
      "syntax error, unexpected '}' at <top-level>, line 1, column 9:",
      "^",
      program,
      2,
    );
    expect(jqErrorOf(stderr, program)).toEqual({
      kind: "syntax",
      message:
        "The jq program does not compile: syntax error, unexpected '}' at line 1, column 9. Fix the program at the marked position.",
      position: 8,
    });
  });

  it("counts lines and UTF-8 byte columns", () => {
    const program = 'def f:\n  "é😀" | {a: };\nf';
    const stderr = compile(
      "syntax error, unexpected '}' at <top-level>, line 2, column 18:",
      "^",
      program,
    );
    expect(jqErrorOf(stderr, program).position).toBe(program.indexOf("}"));
  });

  it("keeps a position past the end inside the program", () => {
    const stderr = compile("unexpected end of file at <top-level>, line 1, column 9:", "^", ".a |");
    expect(jqErrorOf(stderr, ".a |").position).toBe(4);
  });

  it("names a compile error that has no location", () => {
    expect(jqErrorOf("jq: error: module not found: m\n\njq: 1 compile error", "x")).toEqual({
      kind: "syntax",
      message:
        "The jq program does not compile: module not found: m. Fix the program and run it again.",
    });
  });
});

describe("jqErrorOf on runtime errors", () => {
  it.each([
    [
      'jq: error (at /dev/stdin:0): Cannot index number with string ("b")',
      'Cannot index number with string ("b")',
    ],
    ['jq: error (at /dev/stdin:0) (not a string): {"a":1}', '{"a":1}'],
    ["jq: error (at <unknown>): x", "x"],
    [
      "jq: parse error: Exceeds depth limit for parsing at line 1, column 10001",
      "parse error: Exceeds depth limit for parsing at line 1, column 10001",
    ],
  ])("turns %j into a runtime error", (stderr, detail) => {
    expect(jqErrorOf(stderr, ".")).toEqual({
      kind: "runtime",
      message: `The jq program failed on this value: ${detail}. Check the program against the value's shape; ? and // skip the parts that may be missing.`,
    });
  });

  it("keeps halt_error's text as it is", () => {
    expect(jqErrorOf('{"code":3}', ".")).toEqual({ kind: "runtime", message: '{"code":3}' });
  });
});
