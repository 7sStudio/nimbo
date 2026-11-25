// Branches and stash against the real git: list with upstream and counts, create from a start point, switch (a remote
// branch tracked, saved local changes refused then stashed, an open notebook's file merged around its unsaved edit),
// rename, delete (unmerged refused, force only with confirm), names that look like options refused, a path
// with spaces and unicode; then a stash round trip and a conflicting pop that keeps its stash.
import { readFile, writeFile } from "node:fs/promises";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { expect, it } from "vitest";

import { startDaemon } from "../../fixtures/daemon.js";
import {
  isolateGit,
  makeRepo,
  notebookText,
  pushFrom,
  sh,
  withRemote,
} from "../../fixtures/git.js";

isolateGit();

const current = (dir: string) => sh(dir, "branch", "--show-current").trim();

it("lists branches and switches to a remote one through a local branch tracking it", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    await withRemote(ws.dir, async ({ other }) => {
      sh(other, "switch", "-q", "-c", "feature");
      sh(other, "push", "-q", "-u", "origin", "feature");
      await pushFrom(other, { "f.txt": "f\n" }, "feature work");
      const { client } = await startDaemon(ws);
      await client.git.fetch({});
      const listed = await client.git.branches({});
      expect(listed.current).toBe("main");
      expect(listed.local).toEqual([
        expect.objectContaining({ name: "main", current: true, upstream: "origin/main" }),
      ]);
      expect(listed.remote.map((branch) => branch.name).sort()).toEqual([
        "origin/feature",
        "origin/main",
      ]);
      expect(await client.git.switch({ branch: "origin/feature" })).toEqual({
        branch: "feature",
        stashed: false,
      });
      expect(current(ws.dir)).toBe("feature");
      expect(sh(ws.dir, "rev-parse", "--abbrev-ref", "feature@{u}").trim()).toBe("origin/feature");
      await expect(client.git.switch({ branch: "--orphan" })).rejects.toMatchObject({
        name: "InvalidParams",
      });
    });
  });
});

it("creates and renames branches, refusing names git refuses or that look like options", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    sh(ws.dir, "branch", "feature");
    const { client } = await startDaemon(ws);
    for (const name of ["från main", "-D", "a..b", "x\u0007"])
      await expect(client.git.branchCreate({ name })).rejects.toMatchObject({
        name: "InvalidParams",
      });
    await client.git.branchCreate({ name: "från-main", start: "main" });
    expect(current(ws.dir)).toBe("från-main");
    await expect(client.git.branchCreate({ name: "feature" })).rejects.toMatchObject({
      data: { reason: "exists" },
    });
    await client.git.branchCreate({ name: "spare", switch: false });
    expect(current(ws.dir)).toBe("från-main");
    expect(await client.git.branchRename({ to: "renamed" })).toEqual({ branch: "renamed" });
    expect(current(ws.dir)).toBe("renamed");
  });
});

it("deletes a merged branch, refuses an unmerged one, and force-deletes only with confirm", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    sh(ws.dir, "branch", "spare");
    sh(ws.dir, "switch", "-q", "-c", "topic");
    sh(ws.dir, "commit", "-q", "--allow-empty", "-m", "only here");
    const { client } = await startDaemon(ws);
    await expect(client.git.branchDelete({ name: "topic" })).rejects.toMatchObject({
      name: "GitFailed",
    });
    await client.git.switch({ branch: "main" });
    expect(await client.git.branchDelete({ name: "spare" })).toMatchObject({ branch: "spare" });
    await expect(client.git.branchDelete({ name: "topic" })).rejects.toMatchObject({
      data: { reason: "unmerged" },
    });
    await expect(client.git.branchDelete({ name: "topic", force: true })).rejects.toMatchObject({
      data: { reason: "confirm" },
    });
    await client.git.branchDelete({ name: "topic", force: true, confirm: true });
    expect(sh(ws.dir, "branch", "--list", "topic").trim()).toBe("");
  });
});

const twoCells = (a: string, b: string) =>
  notebookText([
    { id: "c_aaaaaa", source: a },
    { id: "c_bbbbbb", source: b },
  ]);

/** main and a branch other changing the text file and cell b of n.jsnb; main checked out. */
async function twoBranches(ws: { dir: string; path: (...parts: string[]) => string }) {
  await makeRepo(ws.dir, {
    "dir with space/ünï.txt": "1\n",
    "n.jsnb": twoCells("const a = 1;", "const b = 1;"),
  });
  sh(ws.dir, "switch", "-q", "-c", "other");
  await writeFile(ws.path("dir with space", "ünï.txt"), "2\n");
  await writeFile(ws.path("n.jsnb"), twoCells("const a = 1;", "const b = 9;"));
  sh(ws.dir, "commit", "-q", "-am", "other");
  sh(ws.dir, "switch", "-q", "main");
}

it("refuses a switch that would overwrite saved changes, stashes them on request, and merges an open notebook around its unsaved edit", async () => {
  await withWorkspace(async (ws) => {
    await twoBranches(ws);
    const { client } = await startDaemon(ws);
    await client.settings.set({ key: "files.autoSave", value: "off" });
    await client.notebook.open({ path: "n.jsnb" });
    await client.cell.update({ notebook: "n.jsnb", cell: "c_aaaaaa", source: "const a = 2;" });
    await writeFile(ws.path("dir with space", "ünï.txt"), "local\n");
    const refused: unknown = await client.git.switch({ branch: "other" }).catch((e: unknown) => e);
    expect(refused).toMatchObject({
      data: { reason: "localChanges", message: expect.stringContaining("ünï.txt") as unknown },
    });
    expect(await readFile(ws.path("n.jsnb"), "utf8")).toContain("const a = 1;"); // nothing saved behind the user
    expect(current(ws.dir)).toBe("main");

    expect(await client.git.switch({ branch: "other", stash: true })).toEqual({
      branch: "other",
      stashed: true,
    });
    const sources = async () =>
      (await client.notebook.get({ notebook: "n.jsnb" })).notebook.cells.map((c) => c.source);
    expect(await sources()).toEqual(["const a = 2;", "const b = 9;"]); // and no conflict
    const { stashes } = await client.git.stashList({});
    expect(stashes).toEqual([
      expect.objectContaining({ index: 0, message: "On main: nimbo: before switching to other" }),
    ]);
    await client.git.switch({ branch: "main" });
    expect(await sources()).toEqual(["const a = 2;", "const b = 1;"]);
    expect(await client.git.stashPop({ index: 0 })).toEqual({ result: "applied", conflicts: [] });
    expect(await readFile(ws.path("dir with space", "ünï.txt"), "utf8")).toBe("local\n");
    expect(await sources()).toEqual(["const a = 2;", "const b = 1;"]);
  });
});

it("stashes with a message and untracked files, applies, drops with confirm, and keeps a conflicting pop", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    const { client } = await startDaemon(ws);
    expect(await client.git.stash({})).toEqual({ created: false });
    await writeFile(ws.path("a.txt"), "mine\n");
    await writeFile(ws.path("new.txt"), "n\n");
    expect(await client.git.stash({ message: "-- wip --", untracked: true })).toEqual({
      created: true,
    });
    expect(sh(ws.dir, "status", "--porcelain").trim()).toBe("");
    const [entry] = (await client.git.stashList({})).stashes;
    expect(entry).toMatchObject({ index: 0, message: "On main: -- wip --" });
    await client.git.stashApply({ index: 0 });
    expect(await readFile(ws.path("new.txt"), "utf8")).toBe("n\n");
    await expect(client.git.stashDrop({ index: 0 })).rejects.toMatchObject({
      data: { reason: "confirm" },
    });
    await expect(
      client.git.stashDrop({ index: 0, oid: "0".repeat(40), confirm: true }),
    ).rejects.toMatchObject({ name: "GitFailed" });
    await client.git.stashDrop({ index: 0, oid: entry?.oid, confirm: true });
    expect((await client.git.stashList({})).stashes).toEqual([]);

    sh(ws.dir, "stash", "push", "-q");
    await writeFile(ws.path("a.txt"), "theirs\n");
    sh(ws.dir, "commit", "-q", "-am", "theirs");
    const popped = await client.git.stashPop({ index: 0 });
    expect(popped).toEqual({ result: "conflicts", conflicts: ["a.txt"] });
    expect((await client.git.stashList({})).stashes).toHaveLength(1);
    await expect(client.git.stashApply({ index: 7 })).rejects.toMatchObject({
      name: "InvalidParams",
    });
  });
});
