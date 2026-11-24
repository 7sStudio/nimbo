// Tests hints.ts: dates, links, JSON in strings, folds, function sources and add-on hooks, on a fixed clock and zone.
import { beforeAll, describe, expect, it } from "vitest";

import type { HintContext } from "./hints.js";
import { hintsFor, looksLikeJson, parseJsonText } from "./hints.js";
import { localIso } from "./time.js";

// ICU loads its time zone data on a process's first DateTimeFormat (about 12 ms): setup, not any one test's time.
beforeAll(() => {
  localIso(0, "Europe/Paris");
});

const context: HintContext = {
  now: () => Date.parse("2026-10-12T09:00:00Z"),
  timeZone: "Europe/Paris",
};
const kinds = (node: unknown, extra: HintContext = {}): string[] =>
  hintsFor(node, { ...context, ...extra }).map((h) => h.kind);

describe("hints for numbers", () => {
  it("reads 10-digit seconds and 13-digit milliseconds within 20 years as a date", () => {
    expect(hintsFor(1760105124, context)).toEqual([
      {
        kind: "time",
        source: "seconds",
        ms: 1760105124000,
        absolute: "2025-10-10 16:05:24",
        relative: "1 y ago",
        tooltip: "2025-10-10T16:05:24.000+02:00, 1 y ago",
      },
    ]);
    expect(hintsFor(1760105124000, context)[0]).toMatchObject({
      source: "milliseconds",
      absolute: "2025-10-10 16:05:24",
    });
  });

  it("leaves other numbers alone", () => {
    expect([
      kinds(1000000000),
      kinds(12345678901),
      kinds(1760105124.5),
      kinds(-1760105124),
      kinds(42),
    ]).toEqual([[], [], [], [], []]);
  });
});

describe("hints for strings", () => {
  it("dates ISO text, absolute with the relative time as the hint", () => {
    expect(hintsFor("2026-10-12T08:57:00Z", context)).toEqual([
      {
        kind: "time",
        source: "iso",
        ms: Date.parse("2026-10-12T08:57:00Z"),
        absolute: "2026-10-12T10:57:00.000+02:00",
        relative: "3 min ago",
        tooltip: "2026-10-12T10:57:00.000+02:00, 3 min ago",
      },
    ]);
    expect([kinds("2026-10-12"), kinds("version 2026-10-12T08:57:00Z")]).toEqual([[], []]);
  });

  it("links http(s) URLs only", () => {
    expect(hintsFor("https://dashboard.stripe.com/test/payments/pi_1", context)).toEqual([
      { kind: "link", href: "https://dashboard.stripe.com/test/payments/pi_1" },
    ]);
    expect([kinds("javascript:alert(1)"), kinds("https://a b"), kinds("ftp://x")]).toEqual([
      [],
      [],
      [],
    ]);
  });

  it("offers a tree for JSON objects and arrays and folds long strings", () => {
    expect([kinds('{"a":1}'), kinds(" [1,2] "), kinds("{not json}"), kinds('"str"')]).toEqual([
      ["json"],
      ["json"],
      [],
      [],
    ]);
    expect(hintsFor("x".repeat(1001), context)).toEqual([
      { kind: "fold", length: 1001, shown: 120 },
    ]);
    expect(kinds("x".repeat(1000))).toEqual([]);
  });
});

describe("parseJsonText", () => {
  it("gives the wire form of the JSON, $ keys escaped", () => {
    expect(parseJsonText('{"$type":"x","a":[1]}')).toEqual({
      json: { $$type: "x", a: [1] },
      truncated: false,
    });
    expect([parseJsonText("1"), parseJsonText("{")]).toEqual([undefined, undefined]);
    expect(looksLikeJson("{}")).toBe(true);
  });
});

describe("hints for markers", () => {
  it("dates a Date and not an invalid one", () => {
    expect(hintsFor({ $type: "date", iso: "2026-10-12T08:57:00.000Z" }, context)[0]).toMatchObject({
      source: "date",
      relative: "3 min ago",
    });
    expect(kinds({ $type: "date", iso: null })).toEqual([]);
  });

  it("links a function to the cell the host says defined it", () => {
    const functionSource = (name: string) =>
      name === "createIntent" ? { cell: "c_a1b2c3", label: "cell 3" } : undefined;
    expect(
      hintsFor({ $type: "function", name: "createIntent" }, { ...context, functionSource }),
    ).toEqual([
      { kind: "source", name: "createIntent", target: { cell: "c_a1b2c3", label: "cell 3" } },
    ]);
    expect([
      kinds({ $type: "function", name: "other" }, { functionSource }),
      kinds({ $type: "function", name: "f" }),
    ]).toEqual([[], []]);
  });
});

describe("hint hooks", () => {
  it("run after the built-in hints with the node, its kind and its path", () => {
    const stripe = ({
      node,
      kind,
      path,
    }: {
      node: unknown;
      kind: string;
      path: readonly (string | number)[];
    }) =>
      kind === "string" && typeof node === "string" && node.startsWith("pi_")
        ? {
            kind: "custom" as const,
            id: "stripe",
            label: "Open in Stripe",
            href: `https://dashboard.stripe.com/payments/${node}`,
            tooltip: `at ${String(path.length)}`,
          }
        : undefined;
    expect(hintsFor("pi_1", { ...context, hooks: [stripe] }, ["id"])).toEqual([
      {
        kind: "custom",
        id: "stripe",
        label: "Open in Stripe",
        href: "https://dashboard.stripe.com/payments/pi_1",
        tooltip: "at 1",
      },
    ]);
    expect(hintsFor("ch_1", { ...context, hooks: [stripe] })).toEqual([]);
  });

  it("read the runtime's clock when none is injected", () => {
    expect(hintsFor(1760105124000, { timeZone: "UTC" })[0]?.kind).toBe("time");
  });
});
