// The words of a run's error block: what Details holds, the text Copy error
// writes, and the caret under a syntax error's column.
import type { ErrorInfo } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { caretLine, detailsWords, errorText } from "./errorWords.js";

const error = (patch: Partial<ErrorInfo> = {}): ErrorInfo => ({
  name: "StripeInvalidRequestError",
  message: "Charge ch_3Q4fK2 has already been refunded.",
  frames: [],
  raw: "",
  ...patch,
});

describe("detailsWords", () => {
  it("names up to three short fields of its data and the length of its stack", () => {
    const frame = { line: 1, col: 1 };
    const detailed = error({
      frames: [frame, frame, frame, frame, frame, frame, frame],
      data: {
        code: "charge_already_refunded",
        statusCode: 400,
        requestId: "req_8fK2aQ",
        retried: false,
        raw: { nested: true },
        excerpt: "> 1 | x",
      },
    });
    expect(detailsWords(detailed)).toBe(
      "code charge_already_refunded, statusCode 400, requestId req_8fK2aQ, 7 stack frames",
    );
  });

  it("says a cell by its number alone, never twice, and leaves out what would not fit a line", () => {
    const inClient = error({
      name: "DefinedInClient",
      frames: [{ line: 1, col: 9 }],
      data: {
        name: "format",
        cell: "cell 2",
        index: 2,
        cause: { name: "X" },
        long: "x".repeat(60),
      },
    });
    expect(detailsWords(inClient)).toBe("name format, cell 2, 1 stack frame");
    expect(detailsWords(error({ data: { empty: "" } }))).toBe("");
  });
});

describe("errorText and caretLine", () => {
  it("copies the stack as the user reads it, or the name and message without one", () => {
    expect(errorText(error({ raw: "TypeError: x\n    at cell 2:1:1" }))).toBe(
      "TypeError: x\n    at cell 2:1:1",
    );
    expect(errorText(error({ raw: "  " }))).toBe(
      "StripeInvalidRequestError: Charge ch_3Q4fK2 has already been refunded.",
    );
  });

  it("puts the caret under the column, keeping the line's own tabs", () => {
    expect(caretLine("const x = ;", 11)).toBe("          ^");
    expect(caretLine("\tconst x = ;", 12)).toBe("\t          ^");
    expect(caretLine("ab", 9)).toBe("  ^");
    expect(caretLine("ab", 0)).toBe("^");
  });
});
