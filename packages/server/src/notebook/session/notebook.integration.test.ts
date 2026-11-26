// The notebook commands through the daemon: create and open (once), the errors of a closed, missing or
// escaping notebook, close and the seq that keeps counting after a re-open, a reload of a file that is gone.
import { readFile, rm, stat } from "node:fs/promises";

import { productVersion } from "@jsnb/core";

import { withDaemon } from "../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

const empty = `{\n  "version": 1,\n  "jsnb": "${productVersion}",\n  "cells": []\n}\n`;

describe("notebook.create and notebook.open", () => {
  it("creates an empty notebook, opens it once, and refuses to create it again", async () => {
    await withDaemon(async (daemon, ws) => {
      const created = await daemon.client.notebook.create({ path: "sub/demo.jsnb" });
      expect(created.notebook).toMatchObject({ path: "sub/demo.jsnb", cells: [], dirty: false });
      expect(await readFile(ws.path("sub/demo.jsnb"), "utf8")).toBe(empty);
      await daemon.events.until("notebook.opened", (e) => e.notebook === "sub/demo.jsnb");
      const opened = await daemon.client.notebook.open({ path: "sub/demo.jsnb" });
      expect(opened.notebook.path).toBe("sub/demo.jsnb");
      expect(daemon.events.all().filter((e) => e.type === "notebook.opened")).toHaveLength(1);
      await expect(daemon.client.notebook.create({ path: "sub/demo.jsnb" })).rejects.toMatchObject({
        code: 1005,
      });
    });
  });

  it("lists the notebook in workspace.info as open, with its file's mtime and size", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      const stats = await stat(ws.path("a.jsnb"));
      expect((await daemon.client.workspace.info({})).notebooks).toEqual([
        { path: "a.jsnb", open: true, modifiedAt: stats.mtime.toISOString(), bytes: stats.size },
      ]);
    });
  });
});

describe("a notebook that is not open", () => {
  it("is NOTEBOOK_NOT_FOUND, said 'not open' when its file exists", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      await daemon.client.notebook.close({ notebook: "a.jsnb" });
      await expect(daemon.client.notebook.get({ notebook: "a.jsnb" })).rejects.toMatchObject({
        code: 1001,
        data: { path: "a.jsnb", closed: true },
        message: "a.jsnb is not open. Open it with notebook.open first.",
      });
      await expect(daemon.client.notebook.open({ path: "missing.jsnb" })).rejects.toMatchObject({
        code: 1001,
      });
    });
  });

  it("refuses a ref that leaves the workspace or names no notebook with INVALID_PARAMS", async () => {
    await withDaemon(async (daemon) => {
      for (const path of ["../x.jsnb", "/abs.jsnb", "a.txt", "a/./b.jsnb"]) {
        await expect(daemon.client.notebook.open({ path })).rejects.toMatchObject({ code: -32602 });
      }
    });
  });
});

describe("notebook.close", () => {
  it("emits notebook.closed and keeps counting seq after a re-open", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      await daemon.client.cell.add({ notebook: "a.jsnb", type: "markdown", source: "# hi" });
      await daemon.client.notebook.close({ notebook: "a.jsnb" });
      const closed = await daemon.events.until("notebook.closed");
      await daemon.client.notebook.open({ path: "a.jsnb" });
      const reopened = await daemon.events.until("notebook.opened", (e) => e.seq > closed.seq);
      expect(reopened.seq).toBeGreaterThan(closed.seq);
      const state = await daemon.client.notebook.get({ notebook: "a.jsnb" });
      expect(state.notebook.cells.map((cell) => cell.source)).toEqual(["# hi"]);
    });
  });
});

describe("notebook.reload of a file that is gone", () => {
  it("is NOTEBOOK_NOT_FOUND, the open notebook kept as it was", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      await daemon.client.cell.add({ notebook: "a.jsnb", type: "markdown", source: "# kept" });
      await daemon.events.until("notebook.saved");
      await rm(ws.path("a.jsnb"));
      await expect(daemon.client.notebook.reload({ notebook: "a.jsnb" })).rejects.toMatchObject({
        code: 1001,
        data: { path: "a.jsnb" },
      });
      const state = await daemon.client.notebook.get({ notebook: "a.jsnb" });
      expect(state.notebook.cells.map((cell) => cell.source)).toEqual(["# kept"]);
    });
  });
});
