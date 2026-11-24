// Tests leaf.ts: the text and syntax tokens of every leaf of the wire form.
import { beforeAll, describe, expect, it } from "vitest";

import { bytesHex, leafText, leafTokens } from "./leaf.js";
import { kindOf } from "./wire.js";
import { localIso } from "./time.js";

// ICU loads its time zone data on a process's first DateTimeFormat (about 12 ms): setup, not any one test's time.
beforeAll(() => {
  localIso(0, "Europe/Paris");
});

const paris = { timeZone: "Europe/Paris" } as const;
const text = (node: unknown): string => leafText(node, kindOf(node), paris);
const tokens = (node: unknown, at?: readonly (string | number)[]) =>
  leafTokens(node, kindOf(node), at === undefined ? paris : { ...paris, at });

describe("leafText", () => {
  it("is the text without decorations", () => {
    expect([
      text("a\nb"),
      text(1.5),
      text(true),
      text(false),
      text(null),
      text({ $type: "undefined" }),
    ]).toEqual(["a\nb", "1.5", "true", "false", "null", "undefined"]);
    expect([
      text({ $type: "number", value: "-0" }),
      text({ $type: "number" }),
      text({ $type: "bigint", value: "12" }),
    ]).toEqual(["-0", "NaN", "12n"]);
    expect([
      text({ $type: "regexp", source: "^pi_", flags: "i" }),
      text({ $type: "truncated" }),
    ]).toEqual(["/^pi_/i", "truncated"]);
  });

  it("shows a date in the zone and an invalid one as Invalid Date", () => {
    expect([
      text({ $type: "date", iso: "2026-10-10T14:02:11.000Z" }),
      text({ $type: "date", iso: null }),
    ]).toEqual(["2026-10-10T16:02:11.000+02:00", "Invalid Date"]);
  });

  it("names functions, errors and refs", () => {
    expect([
      text({ $type: "function", name: "f" }),
      text({ $type: "function", name: "" }),
      text({ $type: "error", name: "TypeError", message: "x" }),
    ]).toEqual(["f", "(anonymous)", "TypeError: x"]);
    expect([
      text({ $type: "error" }),
      text({ $type: "ref", path: ["a", 0] }),
      leafText(3, "object"),
    ]).toEqual(["Error: ", "$.a[0]", ""]);
  });
});

describe("bytesHex", () => {
  it("shows the first 8 bytes and an ellipsis when there are more", () => {
    expect(bytesHex({ $type: "bytes", length: 16, base64: "H4sIAAAAAAAAA8tIzcnJBw==" })).toBe(
      "1f 8b 08 00 00 00 00 00 …",
    );
    expect(bytesHex({ $type: "bytes", length: 3, base64: "aGkh" })).toBe("68 69 21");
    expect(bytesHex({ $type: "bytes", length: 3, base64: 7 })).toBe(" …");
  });
});

describe("leafTokens", () => {
  it("colors each kind of leaf", () => {
    expect(tokens("hi")).toEqual([{ kind: "str", text: '"hi"' }]);
    expect(tokens(2)).toEqual([{ kind: "num", text: "2" }]);
    expect(tokens(false)).toEqual([{ kind: "bool", text: "false" }]);
    expect(tokens(null)).toEqual([{ kind: "nul", text: "null" }]);
    expect(tokens({ $type: "date", iso: "2026-10-10T14:02:11.000Z" })).toEqual([
      { kind: "typ", text: "Date" },
      { kind: "text", text: " 2026-10-10T16:02:11.000+02:00" },
    ]);
    expect(tokens({ $type: "function", name: "f" })).toEqual([
      { kind: "typ", text: "ƒ " },
      { kind: "fn", text: "f" },
    ]);
  });

  it("writes bytes with their length and an error with its name", () => {
    expect(
      tokens({ $type: "bytes", length: 2, base64: "aGk=" })
        .map((t) => t.text)
        .join(""),
    ).toBe("bytes(2) [68 69]");
    expect(
      tokens({ $type: "error", name: "TypeError", message: "x" })
        .map((t) => t.text)
        .join(""),
    ).toBe('TypeError: "x"');
  });

  it("tells a cycle from a repeated reference by the node's own path", () => {
    expect(tokens({ $type: "ref", path: ["a"] }, ["a", "self"])).toEqual([
      { kind: "nul", text: "[Circular → $.a]" },
    ]);
    expect(tokens({ $type: "ref", path: ["a"] }, ["b"])).toEqual([
      { kind: "nul", text: "[Ref → $.a]" },
    ]);
    expect(tokens({ $type: "ref", path: ["a"] })).toEqual([{ kind: "nul", text: "[Ref → $.a]" }]);
  });
});
