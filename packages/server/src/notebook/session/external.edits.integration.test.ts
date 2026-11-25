// External edits and stale bases against the real daemon (07-file-format §5): a write that found the file unreadable
// is a conflict with its recovery copy while the file does not parse, and is made once the file is the base again; a
// second stale edit during an open conflict keeps every held cell in the conflict; two agents with the same client name
// are two editors.
import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";

import { textHash } from "@jsnb/core";
import { expect, it } from "vitest";

import { connectDaemon, withDaemon } from "../../fixtures/daemon.js";
import { cellOf, docOf, threeSaved } from "../../fixtures/external.js";

const notebook = "a.jsnb";

it("makes the write an unreadable file held once the file is the base again", async () => {
  await withDaemon(async (daemon, ws) => {
    const { ids } = await threeSaved(daemon);
    const path = ws.path(notebook);
    const original = await readFile(path, "utf8");
    await writeFile(path, "{ broken");
    await daemon.events.until("notebook.reconciled", (e) => e.data.outcome === "unreadable");
    await daemon.client.cell.update({ notebook, cell: ids[1], source: "export const b = 7" });
    await daemon.events.until("notebook.conflict");
    expect((await daemon.client.notebook.get({ notebook })).notebook.conflict).toBeDefined();
    await expect(daemon.client.notebook.save({ notebook })).rejects.toMatchObject({ code: 1007 });
    await expect
      .poll(async () =>
        existsSync(ws.path(".jsnb", "recovery"))
          ? (await readdir(ws.path(".jsnb", "recovery"))).length
          : 0,
      )
      .toBe(1);
    await writeFile(path, original);
    await daemon.events.until("notebook.conflictEnded");
    await expect
      .poll(async () => cellOf(docOf(await readFile(path, "utf8")), ids[1]).source.join("\n"), {
        timeout: 10_000,
      })
      .toBe("export const b = 7");
    const state = (await daemon.client.notebook.get({ notebook })).notebook;
    expect(state.conflict).toBeUndefined();
    expect(state.dirty).toBe(false);
  });
});

it("lists every held cell when a stale edit joins an open conflict", async () => {
  await withDaemon(async (daemon) => {
    const { ids } = await threeSaved(daemon);
    const [first, second] = ids;
    const page = await connectDaemon(daemon, { client: "ui" });
    try {
      await page.client.cell.update({ notebook, cell: first, source: "1" });
      await page.client.cell.update({ notebook, cell: second, source: "2" });
    } finally {
      page.close();
    }
    await daemon.client.cell.update({
      notebook,
      cell: first,
      source: "11",
      base: textHash("export const a = 1; a"),
    });
    await daemon.client.cell.update({
      notebook,
      cell: second,
      source: "22",
      base: textHash("export const b = 2"),
    });
    const state = (await daemon.client.notebook.get({ notebook })).notebook;
    expect(state.conflict?.cells).toEqual(expect.arrayContaining([first, second]));
    expect(state.conflict?.cells).toHaveLength(2);
  });
});

it("holds an agent's edit on a text another agent of the same client name replaced", async () => {
  await withDaemon(async (daemon) => {
    const { ids } = await threeSaved(daemon);
    const cell = ids[2];
    const one = await connectDaemon(daemon, { client: "cli" });
    const two = await connectDaemon(daemon, { client: "cli" });
    try {
      const read = await one.client.cell.get({ notebook, cell });
      const before = await two.client.cell.get({ notebook, cell });
      await two.client.cell.update({ notebook, cell, source: "a - b", base: before.textHash });
      await one.client.cell.update({ notebook, cell, source: "a * b", base: read.textHash });
      const conflict = await daemon.events.until("notebook.conflict");
      expect(conflict.data.cells).toEqual([cell]);
    } finally {
      one.close();
      two.close();
    }
  });
});
