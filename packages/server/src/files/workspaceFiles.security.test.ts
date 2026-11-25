// What the daemon reads and writes stays inside the workspace (09-testing §5, 07-file-format §7): a `.jsnb` that is a
// symbolic link or a file is refused with WorkspaceUnusable before anything is written through it, and so are its
// logs/, recovery/ and cache/ folders and its log files as links; a notebook whose
// folder or file a symbolic link takes outside the workspace is refused with INVALID_PARAMS and nothing is written
// there, while a link that stays inside works; a FIFO or a folder at a notebook path is refused at once with
// NotebookUnreadable, the daemon answering on.
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";

import { startDaemon } from "../fixtures/daemon.js";
import { kernelEntry } from "@jsnb/test-tools/kernel";
import type { Workspace } from "@jsnb/test-tools/workspace";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { makeFifo } from "../fixtures/fifo.js";
import { within } from "../fixtures/folders.js";
import { startServer } from "../index.js";

const start = (ws: Workspace, workspace: string) =>
  startServer({ workspace, userConfigDir: ws.path(".user"), kernelEntry });

describe("the workspace's .jsnb", () => {
  it("that is a symbolic link or a file is refused with WorkspaceUnusable, nothing written through it", async () => {
    await withWorkspace(async (ws) => {
      const outside = await within(ws, "outside");
      const linked = await within(ws, "linked");
      await symlink(outside.dir, linked.path(".jsnb"));
      await expect(start(ws, linked.dir)).rejects.toMatchObject({
        name: "WorkspaceUnusable",
        data: { reason: "it is a symbolic link" },
      });
      expect(await readdir(outside.dir)).toEqual([]);
      const filed = await within(ws, "filed");
      await writeFile(filed.path(".jsnb"), "");
      await expect(start(ws, filed.dir)).rejects.toMatchObject({
        name: "WorkspaceUnusable",
        data: { reason: "it is not a folder" },
      });
      await expect(start(ws, filed.path(".jsnb"))).rejects.toMatchObject({
        name: "WorkspaceMissing",
      });
    });
  });

  it("that cannot be written is WorkspaceUnusable with its remedy, not a bare EACCES", async () => {
    await withWorkspace(async (ws) => {
      const locked = await within(ws, "locked");
      await chmod(locked.dir, 0o555);
      try {
        await expect(start(ws, locked.dir)).rejects.toMatchObject({
          name: "WorkspaceUnusable",
          message: expect.stringContaining("Make it writable") as unknown,
          data: { reason: "nimbo may not write into it (EACCES)" },
        });
      } finally {
        await chmod(locked.dir, 0o755);
      }
    });
  });
});

describe("the folders and the logs of .jsnb", () => {
  it("as symbolic links out of the workspace are refused WorkspaceUnusable, nothing written through them", async () => {
    await withWorkspace(async (ws) => {
      const outside = await within(ws, "outside");
      for (const [index, folder] of [
        "logs",
        "recovery",
        "cache",
        "cache/npm",
        "cache/sql",
      ].entries()) {
        const work = await within(ws, `work-${String(index)}`);
        await mkdir(work.path(".jsnb", folder, ".."), { recursive: true });
        await symlink(outside.dir, work.path(".jsnb", folder));
        await expect(start(ws, work.dir)).rejects.toMatchObject({
          name: "WorkspaceUnusable",
          data: { reason: "it is a symbolic link" },
        });
      }
      const logged = await within(ws, "logged");
      await mkdir(logged.path(".jsnb", "logs"), { recursive: true });
      await writeFile(outside.path("other.log"), "");
      await symlink(outside.path("other.log"), logged.path(".jsnb", "logs", "daemon.log"));
      await expect(start(ws, logged.dir)).rejects.toMatchObject({ name: "WorkspaceUnusable" });
      expect(await readdir(outside.dir)).toEqual(["other.log"]);
      expect(await readFile(outside.path("other.log"), "utf8")).toBe("");
    });
  });

  it("refuses a kernel log that is a symbolic link: the notebook does not open, nothing written through it", async () => {
    await withWorkspace(async (ws) => {
      const outside = await within(ws, "outside");
      await writeFile(outside.path("kernel.log"), "");
      const work = await within(ws, "work");
      const daemon = await startDaemon(work);
      await symlink(outside.path("kernel.log"), work.path(".jsnb", "logs", "kernel-a.log"));
      await expect(daemon.client.notebook.create({ path: "a.jsnb" })).rejects.toMatchObject({
        data: { name: "WorkspaceUnusable" },
      });
      expect(await readFile(outside.path("kernel.log"), "utf8")).toBe("");
      await daemon.stop();
    });
  });
});

describe("a notebook path through a symbolic link", () => {
  it("is refused with INVALID_PARAMS when it leads outside the workspace, and works inside it", async () => {
    await withWorkspace(async (ws) => {
      const outside = await within(ws, "outside");
      await writeFile(outside.path("away.jsnb"), "{}");
      const work = await within(ws, "work");
      await symlink(outside.dir, work.path("folder"));
      await symlink(outside.path("away.jsnb"), work.path("away.jsnb"));
      const daemon = await startDaemon(work);
      const refused = { code: -32602, data: { issues: [{ path: ["path"] }] } }; // create and open take `path`
      await expect(
        daemon.client.notebook.create({ path: "folder/new.jsnb" }),
      ).rejects.toMatchObject(refused);
      await expect(daemon.client.notebook.open({ path: "away.jsnb" })).rejects.toMatchObject(
        refused,
      );
      expect(await readdir(outside.dir)).toEqual(["away.jsnb"]);
      await mkdir(work.path("real"));
      await symlink(work.path("real"), work.path("alias"));
      await daemon.client.notebook.create({ path: "alias/in.jsnb" });
      expect(existsSync(work.path("real", "in.jsnb"))).toBe(true);
      await daemon.stop();
    });
  });
});

describe("a notebook path that holds no file", () => {
  it("is refused at once with NotebookUnreadable for a FIFO or a folder", async () => {
    await withWorkspace(async (ws) => {
      makeFifo(ws.path("pipe.jsnb"));
      await mkdir(ws.path("folder.jsnb"));
      const daemon = await startDaemon(ws);
      for (const path of ["pipe.jsnb", "folder.jsnb"]) {
        await expect(daemon.client.notebook.open({ path })).rejects.toMatchObject({
          code: -32603,
          data: { name: "NotebookUnreadable" },
        });
      }
      expect((await daemon.client.workspace.info()).pid).toBe(process.pid);
      await daemon.stop();
    });
  });
});
