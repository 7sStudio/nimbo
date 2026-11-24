// Tests serialize: the fixture round trip, determinism, the golden migrated file and random documents.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { createIdGenerator } from "../model/ids.js";
import migrated from "./fixtures/notebooks/v1.migrated.jsnb?raw";
import v1 from "./fixtures/notebooks/v1.jsnb?raw";
import { parse } from "./parse.js";
import type { NotebookDocument } from "./schema.js";
import { serialize } from "./serialize.js";

const ids = createIdGenerator(() => 0.5);
const load = (text: string): NotebookDocument => {
  const result = parse(text, { ids });
  if (!result.ok) throw result.error;
  return result.value.doc;
};

describe("serialize", () => {
  it("writes back exactly what the app wrote and matches the migrated golden", () => {
    expect(serialize(load(v1))).toBe(v1);
    expect(serialize(load(v1))).toBe(migrated);
    expect(v1.endsWith("\n")).toBe(true);
  });

  it("is deterministic and omits empty meta, jsnb and cells", () => {
    const doc = load(v1);
    expect(serialize(doc)).toBe(serialize(structuredClone(doc)));
    expect(serialize({ version: 1, cells: [], extra: {} })).toBe(
      '{\n  "version": 1,\n  "cells": []\n}\n',
    );
  });

  it("writes one element per line, meta keys in order, then unknown keys in insertion order", () => {
    const doc: NotebookDocument = {
      version: 1,
      cells: [
        {
          id: "c_a1b2c3",
          type: "server",
          source: "a\r\n\n🙂",
          meta: { color: "red", lastEdit: { by: "user", client: "ui", at: "t" }, collapsed: true },
          extra: { pinned: [1, 2] },
        },
        { id: "c_d4e5f6", type: "markdown", source: "", meta: {}, extra: {} },
      ],
      extra: { attachments: { a: 1 } },
    };
    expect(serialize(doc)).toMatchSnapshot();
    expect(load(serialize(doc))).toEqual(doc);
  });
});

const cellId = fc.stringMatching(/^c_[0-9a-z]{6}$/);
const meta = fc.record(
  {
    showBindings: fc.boolean(),
    collapsed: fc.boolean(),
    outputView: fc.constantFrom("auto", "tree", "grid", "raw"),
    outputQuery: fc.record(
      {
        mode: fc.constantFrom("filter", "jsonpath", "jq", "sql"),
        query: fc.string({ maxLength: 10 }),
        at: fc.constantFrom("$", "$.data", "$['a b'][0]"),
      },
      { requiredKeys: ["mode", "query"] },
    ),
    outputHeight: fc.constantFrom("capped", "fit"),
    custom: fc.jsonValue({ maxDepth: 1 }),
  },
  { requiredKeys: [] },
);
const cell = fc.record({
  id: cellId,
  type: fc.constantFrom("server", "client", "markdown"),
  source: fc.string({ unit: "binary", maxLength: 20 }),
  meta,
  extra: fc.dictionary(
    fc
      .string({ minLength: 1, maxLength: 3 })
      .filter((k) => !["id", "type", "source", "meta"].includes(k)),
    fc.jsonValue({ maxDepth: 1 }),
    { maxKeys: 2 },
  ),
});
const document = fc.record({
  version: fc.constant(1),
  jsnb: fc.string({ maxLength: 5 }),
  cells: fc.uniqueArray(cell, { maxLength: 3, selector: (c) => c.id }),
  extra: fc.dictionary(
    fc
      .string({ minLength: 1, maxLength: 3 })
      .filter((k) => !["version", "jsnb", "cells"].includes(k)),
    fc.jsonValue({ maxDepth: 1 }),
    { maxKeys: 2 },
  ),
});

describe("parse after serialize", () => {
  it("gives back the document for random documents", () => {
    fc.assert(
      fc.property(document, (doc) => {
        // JSON has no -0: a random -0 in an unknown key reads back as 0, like any JSON writer would give it.
        const expected: unknown = JSON.parse(JSON.stringify(doc));
        expect(load(serialize(doc))).toEqual(expected);
      }),
      { numRuns: 15 },
    );
  });
});
