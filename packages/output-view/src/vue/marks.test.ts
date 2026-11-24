// Tests marks.ts and rawView.ts: runs and lines carry their offsets in the text, the stable keys of the views' v-fors.
import { describe, expect, it } from "vitest";

import { segments, withStarts } from "./marks.js";
import { rawLines } from "./rawView.js";

describe("offsets", () => {
  it("places find's runs and a token list at their offsets", () => {
    expect(segments("cus_123", [[0, 3]])).toEqual([
      { text: "cus", mark: true, start: 0 },
      { text: "_123", mark: false, start: 3 },
    ]);
    expect(withStarts([{ text: "id" }, { text: ": " }]).map((run) => run.start)).toEqual([0, 2]);
  });

  it("places the Raw view's lines in the text and its tokens in their line", () => {
    const lines = rawLines('{\n  "a": 1\n}', true);
    expect(lines.map((line) => line.start)).toEqual([0, 2, 11]);
    expect(lines[1]?.tokens.map((token) => [token.start, token.text])).toEqual([
      [0, "  "],
      [2, '"a"'],
      [5, ":"],
      [6, " "],
      [7, "1"],
    ]);
    expect(rawLines("a\nbc", false).map((line) => line.start)).toEqual([0, 2]);
  });
});
