// Tests detect.ts: the view every output gets and the view a user's choice resolves to.
import { describe, expect, it } from "vitest";

import {
  chooseView,
  detect,
  detectValue,
  displayJson,
  isRenderedMime,
  viewsFor,
} from "./detect.js";
import type { ViewInput } from "./output.js";

const value = (json: unknown): ViewInput => ({ kind: "value", json, repr: "" });
const display = (mime: string, data: string): ViewInput => ({ kind: "display", mime, data });

describe("detectValue", () => {
  it("picks grid, tree, bytes or primitive", () => {
    expect([
      detectValue([{ a: 1 }, { a: 2 }]),
      detectValue([[1], [2]]),
      detectValue([1, 2]),
      detectValue({ a: 1 }),
    ]).toEqual(["grid", "grid", "tree", "tree"]);
    expect([
      detectValue({ $type: "map", entries: [] }),
      detectValue({ $type: "bytes", length: 0, base64: "" }),
      detectValue("s"),
      detectValue({ $type: "date", iso: null }),
    ]).toEqual(["tree", "bytes", "primitive", "primitive"]);
  });
});

describe("detect", () => {
  it("maps every output kind to its view", () => {
    const outputs: ViewInput[] = [
      { kind: "stream", stream: "stderr", text: "" },
      { kind: "error", error: { name: "E", message: "", frames: [], raw: "" } },
      { kind: "dom", html: "", text: "" },
      { kind: "event", name: "e", data: null, at: "" },
      value([{ a: 1 }, { a: 2 }]),
    ];
    expect(outputs.map(detect)).toEqual(["stream", "error", "dom", "event", "grid"]);
  });

  it("renders html and images, reads JSON displays as values and shows any other mime as text", () => {
    expect([
      detect(display("text/html", "<b>")),
      detect(display("image/png", "AA==")),
      detect(display("image/svg+xml", "<svg/>")),
    ]).toEqual(["display", "display", "display"]);
    expect([
      detect(display("application/json", "[[1],[2]]")),
      detect(display("application/json", "{oops")),
      detect(display("text/csv", "a,b")),
    ]).toEqual(["grid", "text", "text"]);
  });
});

describe("isRenderedMime and displayJson", () => {
  it("know the v1 renderers and the JSON payload", () => {
    expect([
      isRenderedMime("image/webp"),
      isRenderedMime("image/"),
      isRenderedMime("text/plain"),
    ]).toEqual([true, false, false]);
    expect(displayJson(display("application/json", '{"a":1}'))).toEqual({ json: { a: 1 } });
    expect(displayJson(value(1))).toBeUndefined();
  });
});

describe("viewsFor", () => {
  it("offers the switch to containers only, Grid when the value reads as one", () => {
    expect([
      viewsFor(value([{ a: 1 }, { a: 2 }])),
      viewsFor(value({ a: 1 })),
      viewsFor(value("x")),
    ]).toEqual([["tree", "grid", "raw"], ["tree", "raw"], []]);
    expect([
      viewsFor(display("application/json", "{}")),
      viewsFor({ kind: "stream", stream: "stdout", text: "" }),
    ]).toEqual([["tree", "raw"], []]);
  });
});

describe("chooseView", () => {
  const records = value([{ a: 1 }, { a: 2 }]);

  it("detects on auto and honours a choice the value allows", () => {
    expect([
      chooseView(records),
      chooseView(records, "tree"),
      chooseView(records, "raw"),
      chooseView(records, "text"),
    ]).toEqual(["grid", "tree", "raw", "text"]);
    expect([
      chooseView(value({ a: 1 }), "grid"),
      chooseView(value({ a: 1 }), "tree"),
      chooseView(value("s"), "tree"),
    ]).toEqual(["tree", "tree", "primitive"]);
  });

  it("ignores the option for outputs that are not values", () => {
    expect(chooseView({ kind: "stream", stream: "stdout", text: "" }, "grid")).toBe("stream");
  });
});
