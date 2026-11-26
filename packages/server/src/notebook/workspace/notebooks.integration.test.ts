// The table of open notebooks: notebook.create of a notebook that is open, or whose open is pending, is
// NOTEBOOK_EXISTS and leaves that session in place; one file is open under one ref only (a path through a linked
// folder, a case variant on a disk that ignores case: NotebookAlreadyOpen naming the open ref), before and after the
// file's saves gave it new inodes; two closes of one notebook at once make one close; a long non-ASCII name opens (its
// kernel log under a bounded name), and a create whose session cannot start leaves no file; a create of a notebook on
// disk that is not open is NOTEBOOK_EXISTS and leaves the file as it is.
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, symlink, writeFile } from "node:fs/promises";

import { productVersion } from "@jsnb/core";

import { withDaemon } from "../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

const empty = `{\n  "version": 1,\n  "jsnb": "${productVersion}",\n  "cells": []\n}\n`;

describe("notebook.create of a notebook that is open", () => {
  it("is NOTEBOOK_EXISTS, the open session kept, also while its open is pending", async () => {
    await withDaemon(async (daemon, ws) => {
      const { client } = daemon;
      await client.notebook.create({ path: "a.jsnb" });
      await client.cell.add({ notebook: "a.jsnb", type: "markdown", source: "# kept" });
      await expect(client.notebook.create({ path: "a.jsnb" })).rejects.toMatchObject({
        code: 1005,
      });
      expect((await client.notebook.get({ notebook: "a.jsnb" })).notebook.cells).toHaveLength(1);
      await writeFile(ws.path("b.jsnb"), empty);
      const [opened, created] = await Promise.allSettled([
        client.notebook.open({ path: "b.jsnb" }),
        client.notebook.create({ path: "b.jsnb" }),
      ]);
      expect([opened.status, created.status]).toEqual(["fulfilled", "rejected"]);
      expect((await client.notebook.get({ notebook: "b.jsnb" })).notebook.path).toBe("b.jsnb");
      const { notebooks } = await client.workspace.info();
      expect(notebooks).toMatchObject([
        { path: "a.jsnb", open: true },
        { path: "b.jsnb", open: true },
      ]);
    });
  });
});

describe("notebook.create of a notebook on disk that is not open", () => {
  it("is NOTEBOOK_EXISTS, the file left as it is, and the notebook opens after", async () => {
    await withDaemon(async (daemon, ws) => {
      const text = empty.replace(
        '"cells": []',
        '"cells": [{ "id": "c_kept01", "type": "markdown", "source": "# kept" }]',
      );
      await writeFile(ws.path("a.jsnb"), text);
      await expect(daemon.client.notebook.create({ path: "a.jsnb" })).rejects.toMatchObject({
        code: 1005,
      });
      expect(await readFile(ws.path("a.jsnb"), "utf8")).toBe(text);
      const { notebook } = await daemon.client.notebook.open({ path: "a.jsnb" });
      expect(notebook.cells.map((cell) => cell.source)).toEqual(["# kept"]);
    });
  });
});

describe("one file under two refs", () => {
  it("is refused NotebookAlreadyOpen: a path through a linked folder, a case variant where the disk ignores case", async () => {
    await withDaemon(async (daemon, ws) => {
      await mkdir(ws.path("real"));
      await symlink(ws.path("real"), ws.path("link"));
      await daemon.client.notebook.create({ path: "real/a.jsnb" });
      await expect(daemon.client.notebook.open({ path: "link/a.jsnb" })).rejects.toMatchObject({
        code: -32603,
        data: { name: "NotebookAlreadyOpen", data: { path: "link/a.jsnb", open: "real/a.jsnb" } },
      });
      const ignoresCase = existsSync(ws.path("REAL", "A.jsnb"));
      const variant = daemon.client.notebook.open({ path: "real/A.jsnb" });
      await expect(variant).rejects.toMatchObject(
        ignoresCase ? { data: { name: "NotebookAlreadyOpen" } } : { code: 1001 },
      );
      expect(daemon.server.port).toBeGreaterThan(0);
    });
  });
});

describe("one file under two refs after its saves", () => {
  it("is still refused NotebookAlreadyOpen once each save renamed a new file into place", async () => {
    await withDaemon(async (daemon, ws) => {
      await mkdir(ws.path("real"));
      await symlink(ws.path("real"), ws.path("link"));
      const notebook = "real/a.jsnb";
      await daemon.client.notebook.create({ path: notebook });
      const before = (await stat(ws.path(notebook))).ino;
      for (const source of ["one", "two"]) {
        await daemon.client.cell.add({ notebook, type: "markdown", source });
        await daemon.events.until("notebook.saved", (e) => e.notebook === notebook);
      }
      expect((await stat(ws.path(notebook))).ino).not.toBe(before);
      await expect(daemon.client.notebook.open({ path: "link/a.jsnb" })).rejects.toMatchObject({
        data: { name: "NotebookAlreadyOpen", data: { path: "link/a.jsnb", open: notebook } },
      });
      const ignoresCase = existsSync(ws.path("REAL", "A.jsnb"));
      await expect(daemon.client.notebook.open({ path: "real/A.jsnb" })).rejects.toMatchObject(
        ignoresCase ? { data: { name: "NotebookAlreadyOpen" } } : { code: 1001 },
      );
      expect((await daemon.client.workspace.info()).notebooks).toMatchObject([
        { path: notebook, open: true },
      ]);
    });
  });
});

describe("two closes of one notebook at once", () => {
  it("make one close: both answer, one notebook.closed", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.notebook.create({ path: "a.jsnb" });
      const closes = await Promise.allSettled([
        daemon.client.notebook.close({ notebook: "a.jsnb" }),
        daemon.client.notebook.close({ notebook: "a.jsnb" }),
      ]);
      expect(closes.map((close) => close.status)).toEqual(["fulfilled", "fulfilled"]);
      await daemon.client.notebook.open({ path: "a.jsnb" });
      await daemon.events.until("notebook.opened", (e) => e.seq > 1);
      const closed = daemon.events.all().filter((e) => e.type === "notebook.closed");
      expect(closed).toHaveLength(1);
    });
  });
});

describe("a notebook with a long non-ASCII name", () => {
  it("opens, its kernel log under a name bounded in bytes", async () => {
    await withDaemon(async (daemon, ws) => {
      const name = `${"日本語のノートブック".repeat(4)}.jsnb`;
      await daemon.client.notebook.create({ path: name });
      const cell = (await daemon.client.cell.add({ notebook: name, type: "server", source: "1" }))
        .cell;
      expect(
        (await daemon.client.cell.run({ notebook: name, cell: cell.id })).execution.status,
      ).toBe("ok");
      const logs = (await readdir(ws.path(".jsnb", "logs"))).filter((file) =>
        file.startsWith("kernel-"),
      );
      expect(logs).toHaveLength(1);
      expect(Buffer.byteLength(logs[0] ?? "")).toBeLessThan(100);
    });
  });
});

describe("notebook.create whose session cannot start", () => {
  it("leaves no file behind", async () => {
    await withDaemon(async (daemon, ws) => {
      // A kernel log planted as a link refuses the session (a log that merely cannot be written opens later).
      await symlink(ws.path("elsewhere.log"), ws.path(".jsnb", "logs", "kernel-a.log"));
      await expect(daemon.client.notebook.create({ path: "a.jsnb" })).rejects.toMatchObject({
        code: -32603,
        data: { name: "WorkspaceUnusable" },
      });
      expect(existsSync(ws.path("a.jsnb"))).toBe(false);
    });
  });
});
