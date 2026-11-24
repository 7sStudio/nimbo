// Tests export.ts: which formats each output offers and what each one writes.
import { describe, expect, it } from "vitest";

import type { Exported, ExportFormat } from "./export.js";
import { exportAs, exportFormats, exportSelection, toJSON, toNDJSON, toText } from "./export.js";
import type { ViewInput } from "./output.js";

const records: ViewInput = {
  kind: "value",
  json: [{ id: 1 }, { id: 2 }],
  repr: "[ { id: 1 }, { id: 2 } ]",
};
const exported = (input: ViewInput, format: ExportFormat): Exported => {
  const outcome = exportAs(input, format);
  if (!outcome.ok) throw new Error(outcome.error.message);
  return outcome.value;
};

describe("exportFormats", () => {
  it("offers formats by output kind", () => {
    const inputs: ViewInput[] = [
      records,
      { kind: "value", json: { a: 1 }, repr: "" },
      { kind: "stream", stream: "stdout", text: "" },
      { kind: "error", error: { name: "E", message: "", frames: [], raw: "" } },
      { kind: "display", mime: "application/json", data: "{}" },
      { kind: "display", mime: "text/html", data: "" },
      { kind: "dom", html: "", text: "" },
      { kind: "event", name: "e", data: 1, at: "" },
    ];
    expect(inputs.map((input) => exportFormats(input).join(" "))).toEqual([
      "json ndjson csv js text html",
      "json ndjson js text html",
      "text html",
      "json text html",
      "json ndjson js text html",
      "text html",
      "text html",
      "json js text html",
    ]);
  });
});

describe("exportAs values", () => {
  it("writes JSON, NDJSON, CSV, a literal and the repr", () => {
    expect(exported(records, "json")).toEqual({
      format: "json",
      mime: "application/json",
      extension: "json",
      text: '[\n  {\n    "id": 1\n  },\n  {\n    "id": 2\n  }\n]\n',
    });
    expect([exported(records, "ndjson").text, exported(records, "csv").text]).toEqual([
      '{"id":1}\n{"id":2}\n',
      "id\r\n1\r\n2\r\n",
    ]);
    expect([exported(records, "js").text, exported(records, "text").text]).toEqual([
      "[\n  {\n    id: 1,\n  },\n  {\n    id: 2,\n  },\n]\n",
      "[ { id: 1 }, { id: 2 } ]\n",
    ]);
    expect(exported({ kind: "value", json: { a: 1 }, repr: "" }, "ndjson").text).toBe('{"a":1}\n');
    expect(exported(records, "html").text).toContain("<table");
  });

  it("refuses a format the output does not offer, saying which it does", () => {
    expect(exportAs({ kind: "value", json: { a: 1 }, repr: "" }, "csv")).toEqual({
      ok: false,
      error: {
        message:
          "CSV is not available for this value output; it offers json, ndjson, js, text, html.",
      },
    });
  });
});

describe("exportAs other outputs", () => {
  it("writes streams without escapes and errors, displays, DOM and events as what they hold", () => {
    expect(
      exported({ kind: "stream", stream: "stdout", text: "\u001b[32mok\u001b[0m\n" }, "text").text,
    ).toBe("ok\n");
    const error = { name: "E", message: "m", frames: [], raw: "E: m" };
    expect([
      exported({ kind: "error", error }, "text").text,
      exported({ kind: "error", error }, "json").text,
    ]).toEqual([
      "E: m\n",
      '{\n  "name": "E",\n  "message": "m",\n  "frames": [],\n  "raw": "E: m"\n}\n',
    ]);
    expect(
      exported({ kind: "display", mime: "application/json", data: '{"a":1}' }, "json").text,
    ).toBe('{\n  "a": 1\n}\n');
    expect(exported({ kind: "dom", html: "<p>hi</p>", text: "hi" }, "text").text).toBe("hi");
    expect(exported({ kind: "display", mime: "text/csv", data: "a,b" }, "text").text).toBe("a,b");
    expect(
      exported({ kind: "event", name: "POST /webhook", data: { s: 1 }, at: "2026-10-10" }, "text")
        .text,
    ).toBe('POST /webhook 2026-10-10\n{\n  "s": 1\n}\n');
    expect(exported({ kind: "event", name: "e", data: [1], at: "" }, "js").text).toBe(
      "[\n  1,\n]\n",
    );
  });
});

describe("exportSelection", () => {
  it("writes the selected nodes as a list, a missing one as null", () => {
    const json = { data: [{ id: 1 }, { $type: "ref", path: ["data", 0] }] };
    expect(
      exportSelection(
        json,
        [
          ["data", 1],
          ["data", 9],
        ],
        "json",
      ).text,
    ).toBe('[\n  {\n    "id": 1\n  },\n  null\n]\n');
    expect(exportSelection(json, [["data", 0, "id"]], "ndjson")).toEqual({
      format: "ndjson",
      mime: "application/x-ndjson",
      extension: "ndjson",
      text: "1\n",
    });
  });
});

describe("toJSON, toNDJSON and toText", () => {
  it("are the JSON, NDJSON and text exports as functions", () => {
    expect([
      toJSON({ a: 1 }),
      toNDJSON([1, "x"]),
      toText({ kind: "stream", stream: "stdout", text: "\u001b[1mok" }),
    ]).toEqual(['{\n  "a": 1\n}\n', '1\n"x"\n', "ok"]);
  });

  it("resolves a node's refs against the root it was taken from (copy value of a subtree)", () => {
    const root = { a: { n: 1 }, b: { $type: "ref", path: ["a"] } };
    expect(toJSON(root.b, root)).toBe('{\n  "n": 1\n}\n');
  });
});
