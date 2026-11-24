// Tests the public API of @jsnb/output-view/model: the names it promises Node consumers, from one import.
import { describe, expect, it } from "vitest";

import * as model from "./index.js";

describe("@jsnb/output-view/model", () => {
  it("exports what it promises Node consumers", () => {
    expect([
      typeof model.detect,
      typeof model.flatten,
      typeof model.search,
      typeof model.parseFilter,
      typeof model.exportAs,
      typeof model.paths,
    ]).toEqual(["function", "function", "function", "function", "function", "object"]);
  });

  it("renders a value end to end the way the CLI's pretty printer will", () => {
    const output = model.toOutput({
      kind: "value",
      json: [
        { id: 1, status: "succeeded" },
        { id: 2, status: "failed" },
      ],
      repr: "",
    });
    const chips = model.parseFilter("status = failed");
    expect(model.detect(output)).toBe("grid");
    expect(chips.ok ? model.formatFilter(chips.value) : "").toBe("status = failed");
    expect(model.paths.format(["data", 0])).toBe("$.data[0]");
    expect(model.exportAs(output, "csv")).toMatchObject({
      ok: true,
      value: { text: "id,status\r\n1,succeeded\r\n2,failed\r\n" },
    });
  });
});
