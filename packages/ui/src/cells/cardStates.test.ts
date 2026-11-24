// The error a card's block shows: a syntax error keeps only its excerpt of its data, and a cell's id anywhere in the
// data is said as the cell's number ("cell 2"), never as the id, or as a cell that is gone.
import type { ErrorInfo } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { shown } from "./cardStates.js";

const numberOf = (cell: string) => (cell === "c_vstpht" ? 2 : 0);
const error = (data?: Record<string, unknown>): ErrorInfo => ({
  name: "DefinedInClient",
  message: "format is defined in client cell 2",
  frames: [{ cell: "c_vstpht", line: 1, col: 9 }],
  raw: "",
  ...(data === undefined ? {} : { data }),
});

describe("shown", () => {
  it("says a cell of the notebook by its number and a gone one in words, leaving the rest as it is", () => {
    const named = shown(
      error({ name: "format", cell: "c_vstpht", gone: "c_aaaaaa", index: 2 }),
      numberOf,
    );
    expect(named.data).toEqual({
      name: "format",
      cell: "cell 2",
      gone: "a cell that is gone",
      index: 2,
    });
    // the frames keep their cell: Jump needs it, and nothing prints it
    expect(named.frames).toEqual([{ cell: "c_vstpht", line: 1, col: 9 }]);
  });

  it("keeps a syntax error's excerpt alone, and an error with no data as it is", () => {
    const syntax = error({ excerpt: "> 1 | const x = ;", line: 1, col: 11 });
    expect(shown(syntax, numberOf).data).toEqual({ excerpt: "> 1 | const x = ;" });
    const bare = error();
    expect(shown(bare, numberOf)).toBe(bare);
  });
});
