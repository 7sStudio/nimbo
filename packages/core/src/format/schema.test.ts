// Tests the NotebookFile schema: lines or a string as source, unknown keys kept, bad shapes refused.
import { describe, expect, it } from "vitest";

import { currentVersion, DocumentCell, NotebookDocument, NotebookFile } from "./schema.js";

describe("NotebookFile", () => {
  it("accepts lines or a string as source and keeps unknown keys", () => {
    const file = NotebookFile.parse({
      version: 1,
      cells: [
        { type: "server", source: "x", meta: { color: 1 } },
        { type: "client", source: ["a"] },
      ],
      attachments: null,
    });
    expect(file.attachments).toBeNull();
    expect(file.cells[0]?.meta).toEqual({ color: 1 });
    expect(currentVersion).toBe(1);
  });

  it("refuses a fractional version, a bad id and a newline in a line", () => {
    expect(NotebookFile.safeParse({ version: 1.5, cells: [] }).success).toBe(false);
    expect(
      NotebookFile.safeParse({ version: 1, cells: [{ id: "x", type: "server", source: [] }] })
        .success,
    ).toBe(false);
    expect(
      NotebookFile.safeParse({ version: 1, cells: [{ type: "server", source: ["a\n"] }] }).success,
    ).toBe(false);
  });
});

describe("NotebookDocument", () => {
  it("requires an id per cell and the extra records", () => {
    const cell = { id: "c_a1b2c3", type: "markdown", source: "", meta: {}, extra: {} };
    expect(DocumentCell.safeParse(cell).success).toBe(true);
    expect(NotebookDocument.safeParse({ version: 1, cells: [cell], extra: {} }).success).toBe(true);
    expect(
      NotebookDocument.safeParse({ version: 1, cells: [{ ...cell, id: undefined }], extra: {} })
        .success,
    ).toBe(false);
  });
});
