// The outputs of runs through the daemon (03-api §4.3, §7.5): cell.outputValue slices from the retained full
// value, its refusals (INVALID_PARAMS), children capped by outputs.maxValueBytes, and the full-value download streamed
// at /outputs/, 404 with INVALID_PARAMS once the value is not retained.
import { truncatedMarker } from "@jsnb/core";
import type { Daemon } from "../../../fixtures/daemon.js";
import { withDaemon } from "../../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { createNotebook } from "../../../fixtures/notebook.js";

const rows = "Array.from({ length: 20000 }, (_, i) => ({ i, text: 'x'.repeat(20) }))";
const expected = Array.from({ length: 20000 }, (_, i) => ({ i, text: "x".repeat(20) }));

/** A notebook whose one cell ran `rows`, and cell.outputValue on its value. */
async function bigValue(daemon: Daemon) {
  const book = await createNotebook(daemon);
  const { cell, execution } = await book.ran(rows);
  const slice = (extra: object) =>
    daemon.client.cell.outputValue({ notebook: book.notebook, cell, index: 0, ...extra });
  return { book, cell, execution, slice };
}

describe("cell.outputValue", () => {
  it("slices the retained full value: children of a path from offset, at most limit", async () => {
    await withDaemon(async (daemon) => {
      const { execution, slice } = await bigValue(daemon);
      expect(execution.outputs[0]).toMatchObject({ kind: "value", truncated: true });
      const tail = await slice({ offset: 19_998, limit: 10 });
      expect(tail).toEqual({ json: expected.slice(19_998), total: 20_000, truncated: false });
      const leaf = await slice({ path: "$[7].text" });
      expect(leaf).toEqual({ json: "x".repeat(20), total: 0, truncated: false });
      const row = await slice({ path: "$[3]" });
      expect(row).toEqual({ json: { i: 3, text: "x".repeat(20) }, total: 2, truncated: false });
      const first = await slice({});
      expect(first).toMatchObject({ total: 20_000, truncated: true });
      expect(first.json).toEqual(expected.slice(0, 2000));
    });
  });
});

describe("cell.outputValue's refusals", () => {
  it("refuses a bad path, a path to nothing, an index that is no value and a run that is not the last", async () => {
    await withDaemon(async (daemon) => {
      const { book, cell, execution, slice } = await bigValue(daemon);
      await daemon.client.cell.run({ notebook: book.notebook, cell });
      for (const [extra, field] of [
        [{ path: "$[" }, "path"],
        [{ path: "$[999999]" }, "path"],
        [{ index: 1 }, "index"],
        [{ execution: execution.id }, "execution"],
      ] as const) {
        await expect(slice(extra)).rejects.toMatchObject({
          code: -32602,
          data: { issues: [{ path: [field] }] },
        });
      }
    });
  });
});

describe("cell.outputValue's budget", () => {
  it("caps each child at outputs.maxValueBytes with the truncated marker", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { cell } = await book.ran("['y'.repeat(300_000), 1]");
      const capped = await daemon.client.cell.outputValue({
        notebook: book.notebook,
        cell,
        index: 0,
      });
      expect(capped).toEqual({
        json: [truncatedMarker, truncatedMarker],
        total: 2,
        truncated: true,
      });
    });
  });
});

describe("GET /outputs/<execution>/<index>.json", () => {
  it("streams the whole retained value, and answers 404 with INVALID_PARAMS once it is not retained", async () => {
    await withDaemon(async (daemon) => {
      const { book, cell, execution } = await bigValue(daemon);
      const ref = { execution: execution.id, index: 0 };
      const response = await daemon.download(ref);
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(await response.json()).toEqual(expected);
      await expect(daemon.download({ ...ref, index: 1 })).rejects.toMatchObject({ code: -32602 });
      await daemon.client.cell.run({ notebook: book.notebook, cell, source: "1" });
      await expect(daemon.download(ref)).rejects.toMatchObject({
        code: -32602,
        data: { issues: [{ path: ["execution"] }] },
      });
    });
  });
});
