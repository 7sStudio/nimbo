// An open notebook follows its file: a rename outside nimbo is found by the file's identity and
// the session takes the new ref with its kernel running on, whether the periodic check, a save or an open notices it
// first; a notebook moved out of the workspace is not followed (the next save writes the old path again); notebook.rename
// of an open notebook keeps it open under the new ref.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { withDaemon } from "../../fixtures/daemon.js";
import type { Daemon } from "../../fixtures/daemon.js";
import { createNotebook, valueOf } from "../../fixtures/notebook.js";

/** A notebook with a server cell that ran (`n` is 42 in its kernel), saved. */
async function ranAndSaved(daemon: Daemon) {
  const book = await createNotebook(daemon, "a.jsnb");
  await book.ran("const n = 42;");
  await daemon.client.notebook.save({ notebook: "a.jsnb" });
  return book;
}

/** What a server cell added to the notebook now at `ref` answers for `n`: the kernel's state survived the move. */
async function kernelValue(daemon: Daemon, ref: string): Promise<unknown> {
  const added = await daemon.client.cell.add({
    notebook: ref,
    type: "server",
    source: "n + 1",
    run: true,
  });
  return valueOf(added.execution);
}

const openRefs = async (daemon: Daemon): Promise<readonly string[]> =>
  (await daemon.client.workspace.info()).notebooks.filter((n) => n.open).map((n) => n.path);

describe("a notebook renamed outside nimbo while open", () => {
  it("is followed by the periodic check: new ref, same kernel, saves to the new file", async () => {
    await withDaemon(
      async (daemon, ws) => {
        await ranAndSaved(daemon);
        await mkdir(ws.path("sub"));
        await rename(ws.path("a.jsnb"), ws.path("sub", "b.jsnb"));
        const moved = await daemon.events.until("notebook.moved");
        expect(moved).toMatchObject({
          notebook: "a.jsnb",
          data: { path: "a.jsnb", to: "sub/b.jsnb" },
        });
        expect(await openRefs(daemon)).toEqual(["sub/b.jsnb"]);
        expect(await kernelValue(daemon, "sub/b.jsnb")).toBe(43);
        await daemon.client.notebook.save({ notebook: "sub/b.jsnb" });
        expect(await readFile(ws.path("sub", "b.jsnb"), "utf8")).toContain("n + 1");
        expect(existsSync(ws.path("a.jsnb"))).toBe(false);
        const log = await daemon.client.kernel.log({ notebook: "sub/b.jsnb" });
        expect(log.path).toMatch(/kernel-sub%2Fb\.log$/);
      },
      { rootCheckMs: 50 },
    );
  });

  it("is followed by a save that finds its file gone, before any periodic check", async () => {
    await withDaemon(
      async (daemon, ws) => {
        await ranAndSaved(daemon);
        await daemon.client.cell.add({ notebook: "a.jsnb", type: "markdown", source: "# later" });
        await rename(ws.path("a.jsnb"), ws.path("b.jsnb"));
        await daemon.client.notebook.save({ notebook: "a.jsnb" });
        expect(existsSync(ws.path("a.jsnb"))).toBe(false);
        expect(await readFile(ws.path("b.jsnb"), "utf8")).toContain("# later");
        expect(await openRefs(daemon)).toEqual(["b.jsnb"]);
      },
      { rootCheckMs: 600_000 },
    );
  });
});

describe("a notebook renamed outside nimbo, then opened at its new path", () => {
  it("is the session an open of the new path finds, never a second one", async () => {
    await withDaemon(
      async (daemon, ws) => {
        await ranAndSaved(daemon);
        await rename(ws.path("a.jsnb"), ws.path("b.jsnb"));
        await daemon.client.notebook.open({ path: "b.jsnb" });
        expect(await openRefs(daemon)).toEqual(["b.jsnb"]);
        expect(await kernelValue(daemon, "b.jsnb")).toBe(43);
      },
      { rootCheckMs: 600_000 },
    );
  });
});

describe("a notebook moved where it cannot be followed", () => {
  it("is not followed out of the workspace: the next save writes the old path again", async () => {
    const outside = await mkdtemp(join(tmpdir(), "nimbo-outside-"));
    try {
      await withDaemon(
        async (daemon, ws) => {
          await ranAndSaved(daemon);
          await rename(ws.path("a.jsnb"), join(outside, "a.jsnb"));
          await daemon.client.cell.add({ notebook: "a.jsnb", type: "markdown", source: "# kept" });
          await daemon.client.notebook.save({ notebook: "a.jsnb" });
          expect(await readFile(ws.path("a.jsnb"), "utf8")).toContain("# kept");
          expect(await openRefs(daemon)).toEqual(["a.jsnb"]);
        },
        { rootCheckMs: 600_000 },
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("notebook.rename of an open notebook", () => {
  it("keeps it open under the new ref, its kernel and unsaved edits with it", async () => {
    await withDaemon(async (daemon, ws) => {
      await ranAndSaved(daemon);
      await daemon.client.cell.add({ notebook: "a.jsnb", type: "markdown", source: "# unsaved" });
      await daemon.client.notebook.rename({ path: "a.jsnb", to: "deep/b.jsnb" });
      expect(await openRefs(daemon)).toEqual(["deep/b.jsnb"]);
      expect(existsSync(ws.path("a.jsnb"))).toBe(false);
      expect(await kernelValue(daemon, "deep/b.jsnb")).toBe(43);
      await daemon.client.notebook.save({ notebook: "deep/b.jsnb" });
      expect(await readFile(ws.path("deep", "b.jsnb"), "utf8")).toContain("# unsaved");
      expect(existsSync(ws.path("a.jsnb"))).toBe(false);
    });
  });
});
