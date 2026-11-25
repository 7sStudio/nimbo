// git.status against the real git: staged and changed files with odd names, a workspace that is
// a subfolder, no repository, no git, a merge with its conflicts, a detached HEAD and a repository with no commit.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { expect, it } from "vitest";

import { startDaemon } from "../../fixtures/daemon.js";
import { isolateGit, makeRepo, notebookText, sh } from "../../fixtures/git.js";
import { locate } from "./status.js";

isolateGit();

it("lists staged, changed, untracked, deleted and renamed files with odd names, and the branch", async () => {
  await withWorkspace(async (ws) => {
    const files = {
      "a.txt": "a\n",
      "b.txt": "b\n",
      "old name.txt": "x\n",
      "ü/n.jsnb": notebookText([]),
    };
    await makeRepo(ws.dir, files);
    await writeFile(ws.path("a.txt"), "a2\n");
    sh(ws.dir, "add", "a.txt");
    await writeFile(ws.path("a.txt"), "a3\n");
    await rm(ws.path("b.txt"));
    sh(ws.dir, "mv", "old name.txt", "new name.txt");
    await writeFile(ws.path("line\nbreak.txt"), "z\n");
    const { repo } = await (await startDaemon(ws)).client.git.status({});
    expect(repo?.branch).toMatchObject({ name: "main", detached: false });
    expect(repo?.state).toBe("clean");
    expect(repo?.staged).toEqual([
      { path: "a.txt", status: "modified", notebook: false },
      { path: "new name.txt", status: "renamed", from: "old name.txt", notebook: false },
    ]);
    expect(repo?.changes).toEqual([
      { path: "a.txt", status: "modified", notebook: false },
      { path: "b.txt", status: "deleted", notebook: false },
      { path: "line\nbreak.txt", status: "untracked", notebook: false },
    ]);
  });
});

it("lists the files under a workspace that is a subfolder, and counts what is outside", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "top.txt": "t\n", "sub/in.txt": "i\n" });
    await writeFile(ws.path("top.txt"), "t2\n");
    sh(ws.dir, "add", "top.txt");
    await writeFile(ws.path("sub/in.txt"), "i2\n");
    const sub = { dir: ws.path("sub"), path: (...parts: string[]) => ws.path("sub", ...parts) };
    const daemon = await startDaemon(sub);
    const { repo } = await daemon.client.git.status({});
    expect(repo?.prefix).toBe("sub/");
    expect(repo?.changes.map((change) => change.path)).toEqual(["in.txt"]);
    expect(repo?.outside).toEqual({ staged: 1, changes: 0 });
    await daemon.client.git.stage({ paths: ["in.txt"] });
    const staged = sh(ws.dir, "diff", "--cached", "--name-only").trim().split("\n");
    expect(staged).toEqual(["sub/in.txt", "top.txt"]);
    await daemon.stop();
  });
});

it("lists an open notebook's unsaved edit as modified, as git.diff sees it before autosave", async () => {
  await withWorkspace(async (ws) => {
    const text = notebookText([{ id: "c_aaaaaa", source: "const a = 1;" }]);
    await makeRepo(ws.dir, { "n.jsnb": text, "m.jsnb": text });
    const { client } = await startDaemon(ws);
    await client.notebook.open({ path: "n.jsnb" });
    await client.notebook.open({ path: "m.jsnb" });
    await client.cell.update({ notebook: "n.jsnb", cell: "c_aaaaaa", source: "const a = 2;" });
    const { repo } = await client.git.status({});
    expect(await readFile(ws.path("n.jsnb"), "utf8")).toBe(text);
    expect(repo?.changes).toEqual([{ path: "n.jsnb", status: "modified", notebook: true }]);
  });
});

it("answers null outside a repository and without git on the PATH, and sees a repository made later", async () => {
  await withWorkspace(async (ws) => {
    const daemon = await startDaemon(ws);
    expect(await daemon.client.git.status({})).toEqual({ repo: null, running: null });
    await expect(daemon.client.git.stage({ paths: ["x"] })).rejects.toMatchObject({
      name: "GitFailed",
    });
    await makeRepo(ws.dir);
    expect((await daemon.client.git.status({})).repo?.branch.name).toBe("main");
    const empty = await mkdtemp(join(tmpdir(), "nimbo-nogit-"));
    expect(await locate(ws.dir, { path: empty })).toBeUndefined();
    await rm(empty, { recursive: true });
  });
});

it("reads a merge in progress with its conflict, then a detached HEAD", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "c.txt": "base\n" });
    sh(ws.dir, "checkout", "-q", "-b", "other");
    await writeFile(ws.path("c.txt"), "other\n");
    sh(ws.dir, "commit", "-q", "-am", "other");
    sh(ws.dir, "checkout", "-q", "main");
    await writeFile(ws.path("c.txt"), "main\n");
    sh(ws.dir, "commit", "-q", "-am", "main");
    expect(() => sh(ws.dir, "merge", "-q", "other")).toThrow();
    const daemon = await startDaemon(ws);
    const merging = (await daemon.client.git.status({})).repo;
    expect(merging?.state).toBe("merging");
    expect(merging?.conflicts).toEqual([{ path: "c.txt", status: "conflicted", notebook: false }]);
    expect(merging?.changes).toEqual([]);
    const diff = await daemon.client.git.diff({ path: "c.txt" });
    expect(diff).toMatchObject({ from: "HEAD", to: "worktree", kind: "text" });
    sh(ws.dir, "merge", "--abort");
    sh(ws.dir, "checkout", "-q", "--detach", "HEAD");
    const detached = (await daemon.client.git.status({})).repo?.branch;
    expect(detached).toMatchObject({ name: null, detached: true });
    await daemon.stop();
  });
});

it("stages, diffs and unstages in a repository with no commit yet", async () => {
  await withWorkspace(async (ws) => {
    sh(ws.dir, "init", "-q", "-b", "main");
    await writeFile(ws.path("new.txt"), "n\n");
    const daemon = await startDaemon(ws);
    await daemon.client.git.stage({ paths: ["new.txt"] });
    const first = (await daemon.client.git.status({})).repo;
    expect(first?.branch.oid).toBeNull();
    expect(first?.staged.map((change) => change.path)).toContain("new.txt");
    expect(await daemon.client.git.diff({ path: "new.txt", staged: true })).toMatchObject({
      from: "none",
      to: "index",
      text: { added: 1, removed: 0 },
    });
    await daemon.client.git.unstage({ paths: ["new.txt"] });
    expect((await daemon.client.git.status({})).repo?.staged).toEqual([]);
    await daemon.stop();
  });
});
