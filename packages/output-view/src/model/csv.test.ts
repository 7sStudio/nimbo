// Tests csv.ts: the CSV of a grid, RFC 4180 quoting, CRLF lines and formula-like text defused.
import { describe, expect, it } from "vitest";

import { toCSV } from "./csv.js";

describe("toCSV", () => {
  it("writes a header and one CRLF line per row, empty for absent, null and undefined", () => {
    expect(
      toCSV([
        { id: 1, name: "a", plan: null },
        { id: 2, name: "b", plan: { $type: "undefined" } },
        { id: 3, name: "c" },
      ]),
    ).toBe("id,name,plan\r\n1,a,\r\n2,b,\r\n3,c,\r\n");
  });

  it("quotes fields with quotes, commas, line breaks or edge spaces", () => {
    expect(
      toCSV([
        { a: 'say "hi"', b: "x,y" },
        { a: "line\nbreak", b: " pad" },
      ]),
    ).toBe('a,b\r\n"say ""hi""","x,y"\r\n"line\nbreak"," pad"\r\n');
  });

  it("defuses text a spreadsheet would run as a formula, not numbers", () => {
    expect(
      toCSV([
        { a: "=SUM(A1)", b: -5 },
        { a: "@x", b: "+1" },
      ]),
    ).toBe("a,b\r\n'=SUM(A1),-5\r\n'@x,'+1\r\n");
  });
});

describe("toCSV cells", () => {
  it("writes markers as text: dates as ISO, containers as compact JSON, refs resolved", () => {
    const rows = [
      {
        d: { $type: "date", iso: "2026-10-10T14:02:11.000Z" },
        o: { k: [1] },
        r: { $type: "bigint", value: "12" },
        e: { $type: "error", name: "E", message: "m" },
      },
      {
        d: { $type: "date", iso: null },
        o: { $type: "ref", path: [0, "o"] },
        r: { $type: "number", value: "NaN" },
        e: { $type: "function", name: "=f" },
      },
    ];
    expect(toCSV(rows)).toBe(
      'd,o,r,e\r\n2026-10-10T14:02:11.000Z,"{""k"":[1]}",12n,E: m\r\n,"{""k"":[1]}",NaN,\'=f\r\n',
    );
  });

  it("writes a matrix with columns 0 … n and refuses a value that is not a grid", () => {
    expect(
      toCSV([
        [1, 2],
        [3, 4],
      ]),
    ).toBe("0,1\r\n1,2\r\n3,4\r\n");
    expect([toCSV({ a: 1 }), toCSV([1, 2])]).toEqual([undefined, undefined]);
  });
});
