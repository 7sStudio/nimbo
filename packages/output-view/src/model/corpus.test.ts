// Tests fixtures/values/output-view.json: each case is what core's encode and util.inspect make of its expression.
import { inspect } from "node:util";
import { runInThisContext } from "node:vm";

import { encode } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { detectValue } from "./detect.js";
import { corpus, inspectOptions } from "./fixtures/corpus.js";
import { valueCases } from "./fixtures/values.js";
import type { WireKind } from "./wire.js";
import { children, isContainer, kindOf } from "./wire.js";

const kindsIn = (json: unknown, into: Set<WireKind>): Set<WireKind> => {
  const kind = kindOf(json);
  into.add(kind);
  if (isContainer(kind)) for (const child of children(json, kind)) kindsIn(child.node, into);
  return into;
};

const wireKinds: readonly WireKind[] = [
  "array",
  "bigint",
  "boolean",
  "bytes",
  "date",
  "error",
  "function",
  "instance",
  "map",
  "null",
  "number",
  "object",
  "ref",
  "regexp",
  "set",
  "special",
  "string",
  "truncated",
  "undefined",
];

describe("output-view.json", () => {
  it.each(corpus)("holds what $name encodes to", ({ name, source, kernel, options }) => {
    const value: unknown = runInThisContext(`(${source})`);
    const encoded = encode(value, options ?? {});
    const json: unknown = JSON.parse(JSON.stringify(encoded.json));
    expect(valueCases.find((c) => c.name === name)).toEqual({
      name,
      ...(kernel ? { source } : {}),
      json,
      repr: inspect(value, inspectOptions),
      truncated: encoded.truncated,
    });
  });

  it("lists every corpus case once, in corpus order", () => {
    expect(valueCases.map((c) => c.name)).toEqual(corpus.map((c) => c.name));
    expect(new Set(valueCases.map((c) => c.name)).size).toBe(valueCases.length);
  });

  it("keeps every repr under the kernel's 4 KB cap, so the cap never cuts one", () => {
    expect(valueCases.filter((c) => c.repr.length > 4096)).toEqual([]);
  });
});

describe("output-view.json coverage", () => {
  it("covers every kind of node of core's wire form", () => {
    const kinds = new Set<WireKind>();
    for (const c of valueCases) kindsIn(c.json, kinds);
    expect([...kinds].sort()).toEqual([...wireKinds].sort());
  });

  it("covers every kind of value", () => {
    const views = new Map(valueCases.map((c) => [c.name, detectValue(c.json)]));
    expect(new Set(views.values())).toEqual(new Set(["primitive", "tree", "grid", "bytes"]));
    expect([views.get("records"), views.get("recordsSparse"), views.get("matrix")]).toEqual([
      "grid",
      "grid",
      "grid",
    ]);
    expect([
      views.get("recordsBelowThreshold"),
      views.get("singleRecord"),
      views.get("raggedRows"),
    ]).toEqual(["tree", "tree", "tree"]);
  });
});
