// History, amend, init and the read-only guarantee against the real git: the log of a branch and of one notebook
// (paged, following a rename), a commit's files, a notebook's diff at a commit; amend (refused on a pushed commit
// without confirm); init outside a repository; and reads that never run a planted hook, fsmonitor, external diff
// driver or textconv.
import { access, chmod, mkdir, writeFile } from "node:fs/promises";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { expect, it } from "vitest";

import { startDaemon } from "../../fixtures/daemon.js";
import { isolateGit, makeRepo, notebookText, sh, withRemote } from "../../fixtures/git.js";

isolateGit();

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

/** n.jsnb set to 1, 2 and 3 over three commits, then other.txt, then n.jsnb renamed m.jsnb. */
async function historyRepo(ws: { readonly dir: string; path: (...parts: string[]) => string }) {
  await makeRepo(ws.dir, { "n.jsnb": notebookText([{ id: "c_aaaaaa", source: "1" }]) });
  for (const value of ["2", "3"]) {
    await writeFile(ws.path("n.jsnb"), notebookText([{ id: "c_aaaaaa", source: value }]));
    sh(ws.dir, "commit", "-q", "-am", `set ${value}`);
  }
  await writeFile(ws.path("other.txt"), "o\n");
  sh(ws.dir, "add", "other.txt");
  sh(ws.dir, "commit", "-q", "-m", "other");
  sh(ws.dir, "mv", "n.jsnb", "m.jsnb");
  sh(ws.dir, "commit", "-q", "-m", "rename");
}

const subjects = (page: { readonly commits: readonly { readonly subject: string }[] }) =>
  page.commits.map((commit) => commit.subject);

it("pages the log of a branch and of a notebook, following its rename", async () => {
  await withWorkspace(async (ws) => {
    await historyRepo(ws);
    const { client } = await startDaemon(ws);
    const page = await client.git.log({ limit: 2 });
    expect(subjects(page)).toEqual(["rename", "other"]);
    expect(page.more).toBe(true);
    expect(page.commits[0]).toMatchObject({ author: "Test", email: "test@example.com" });
    const rest = await client.git.log({ skip: 2, limit: 10 });
    expect(subjects(rest)).toEqual(["set 3", "set 2", "first"]);
    expect(rest.more).toBe(false);
    const file = await client.git.log({ path: "m.jsnb" });
    expect(subjects(file)).toEqual(["rename", "set 3", "set 2", "first"]);
    await expect(client.git.log({ ref: "--all" })).rejects.toMatchObject({ name: "InvalidParams" });
  });
});

it("shows a commit's files and a notebook's diff at a commit against its parent", async () => {
  await withWorkspace(async (ws) => {
    await historyRepo(ws);
    const { client } = await startDaemon(ws);
    const { commits } = await client.git.log({ skip: 2 });
    const set3 = commits[0]?.oid ?? "";
    expect(await client.git.show({ commit: set3 })).toMatchObject({
      subject: "set 3",
      files: [{ path: "n.jsnb", status: "modified", notebook: true }],
    });
    const renamed = await client.git.show({ commit: "HEAD" });
    expect(renamed.files).toEqual([
      { path: "m.jsnb", status: "renamed", from: "n.jsnb", notebook: true },
    ]);
    const diff = await client.git.diff({ path: "n.jsnb", commit: set3 });
    expect(diff).toMatchObject({ kind: "notebook", from: `${set3.slice(0, 7)}^` });
    expect(diff.notebook?.stats.modified).toBe(1);
    const first = await client.git.diff({ path: "n.jsnb", commit: commits[2]?.oid ?? "" });
    expect(first.from).toBe("none");
    await expect(
      client.git.diff({ path: "m.jsnb", commit: set3, base: "HEAD" }),
    ).rejects.toMatchObject({ name: "InvalidParams" });
  });
});

it("amends the last commit, refusing a pushed one without confirm, and initializes a repository", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    await withRemote(ws.dir, async () => {
      const { client } = await startDaemon(ws);
      await writeFile(ws.path("a.txt"), "b\n");
      await client.git.stage({ paths: ["a.txt"] });
      await expect(client.git.commit({ amend: true })).rejects.toMatchObject({
        data: { reason: "confirm" },
      });
      await client.git.commit({ amend: true, message: "first, amended", confirm: true });
      expect(sh(ws.dir, "log", "--format=%s").trim()).toBe("first, amended");
      await writeFile(ws.path("a.txt"), "c\n");
      await client.git.stage({ paths: ["a.txt"] });
      await client.git.commit({ amend: true });
      expect(sh(ws.dir, "log", "--format=%s").trim()).toBe("first, amended");
      expect(sh(ws.dir, "show", "HEAD:a.txt")).toBe("c\n");
      await expect(client.git.commit({})).rejects.toMatchObject({ name: "InvalidParams" });
    });
  });
  await withWorkspace(async (ws) => {
    const { client } = await startDaemon(ws);
    expect((await client.git.status({})).repo).toBeNull();
    const made = await client.git.init({});
    expect(made.branch).not.toBeNull();
    expect((await client.git.status({})).repo).not.toBeNull();
    await expect(client.git.init({})).rejects.toMatchObject({ data: { reason: "exists" } });
  });
});

it("reads without running the repository's hooks, fsmonitor, external diff or textconv", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, {
      "a.txt": "a\n",
      "n.jsnb": notebookText([{ id: "c_aaaaaa", source: "1" }]),
    });
    const marker = ws.path("marker");
    await mkdir(ws.path("hooks"));
    const tool = ws.path("hooks", "tool.sh");
    await writeFile(tool, `#!/bin/sh\necho "$0 $*" >> '${marker}'\n`);
    await chmod(tool, 0o755);
    for (const hook of [
      "post-checkout",
      "pre-commit",
      "reference-transaction",
      "post-index-change",
    ]) {
      await writeFile(ws.path(".git", "hooks", hook), `#!/bin/sh\n'${tool}' ${hook}\n`);
      await chmod(ws.path(".git", "hooks", hook), 0o755);
    }
    sh(ws.dir, "config", "core.fsmonitor", tool);
    sh(ws.dir, "config", "diff.external", tool);
    sh(ws.dir, "config", "diff.planted.textconv", tool);
    sh(ws.dir, "config", "diff.planted.command", tool);
    await writeFile(ws.path(".gitattributes"), "* diff=planted\n");
    await writeFile(ws.path("a.txt"), "changed\n");
    await writeFile(ws.path("n.jsnb"), notebookText([{ id: "c_aaaaaa", source: "2" }]));
    const { client } = await startDaemon(ws);
    await client.git.status({});
    await client.git.diff({ path: "a.txt" });
    await client.git.diff({ path: "n.jsnb", content: true });
    await client.git.log({ path: "a.txt" });
    await client.git.show({ commit: "HEAD" });
    await client.git.diff({ path: "a.txt", commit: "HEAD" });
    await client.git.branches({});
    await client.git.stashList({});
    expect(await exists(marker)).toBe(false);
  });
});
