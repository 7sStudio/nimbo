// Tests the saved outputs: a run per cell id written after the cells in cell order, read back
// whole, and a run of no cell or of the wrong shape dropped with a warning while the notebook still opens.
import { describe, expect, it } from "vitest";

import { createIdGenerator } from "../model/ids.js";
import { parse } from "./parse.js";
import type { NotebookDocument } from "./schema.js";
import { serialize } from "./serialize.js";

const ids = createIdGenerator(() => 0.5);

const doc: NotebookDocument = {
  version: 1,
  cells: [
    { id: "c_aaaaaa", type: "server", source: "1 + 1", meta: {}, extra: {} },
    { id: "c_bbbbbb", type: "server", source: 'console.log("hi")', meta: {}, extra: {} },
  ],
  // written in cell order whatever order the record has
  outputs: {
    c_bbbbbb: {
      status: "ok",
      startedAt: "2026-11-15T10:00:00Z",
      durationMs: 3,
      outputs: [{ kind: "stream", stream: "stdout", text: "hi\n" }],
    },
    c_aaaaaa: {
      status: "error",
      startedAt: "2026-11-15T10:00:00Z",
      outputs: [],
      error: { name: "TypeError", message: "x", frames: [], raw: "TypeError: x" },
    },
  },
  extra: {},
};

describe("saved outputs", () => {
  it("round-trips, written after the cells in cell order", () => {
    const text = serialize(doc);
    expect(text.indexOf('"outputs"')).toBeGreaterThan(text.indexOf('"cells"'));
    expect(text.indexOf('"c_aaaaaa": {\n      "status"')).toBeLessThan(
      text.indexOf('"c_bbbbbb": {\n      "status"'),
    );
    const read = parse(text, { ids });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.warnings).toEqual([]);
    expect(read.value.doc.outputs).toEqual(doc.outputs);
    expect(serialize(read.value.doc)).toBe(text);
  });

  it("drops a run of no cell and a malformed run with a warning, keeps the rest", () => {
    const raw = JSON.parse(serialize(doc)) as { outputs: Record<string, unknown> };
    raw.outputs.c_zzzzzz = raw.outputs.c_aaaaaa;
    raw.outputs.c_aaaaaa = { status: "running", outputs: "nope" };
    const read = parse(JSON.stringify(raw), { ids });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(Object.keys(read.value.doc.outputs ?? {})).toEqual(["c_bbbbbb"]);
    expect(read.value.warnings).toEqual([
      "outputs.c_aaaaaa is not a saved run: dropped",
      "outputs.c_zzzzzz names no cell: dropped",
    ]);
  });

  it("writes no outputs key for a document without one, and an empty one for an empty record", () => {
    const bare: NotebookDocument = { version: doc.version, cells: doc.cells, extra: doc.extra };
    expect(serialize(bare)).not.toContain('"outputs"');
    expect(serialize({ ...doc, outputs: {} })).toContain('"outputs": {}');
  });
});
