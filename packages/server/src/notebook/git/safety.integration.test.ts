// What a git operation must never do, against the real git: drop an edit made while it runs, leave a lock behind
// when cancelled, read a file inside .git, hide stashed changes when a switch fails, queue a write unseen behind a slow
// hook, or take a revision, a remote URL's password or the daemon's GIT_DIR for granted.
import { readFileSync } from "node:fs";
import { access, chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { expect, it } from "vitest";

import { startDaemon } from "../../fixtures/daemon.js";
import {
  isolateGit,
  makeRepo,
  notebookText,
  pushFrom,
  sh,
  until,
  withRemote,
} from "../../fixtures/git.js";
import { redact } from "./exec.js";

isolateGit();

const hook = async (dir: string, name: string, body: string): Promise<void> => {
  const path = join(dir, ".git", "hooks", name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
};

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

it("keeps an edit made during a pull: a notebook git changed conflicts, one it left saves it", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, {
      "n.jsnb": notebookText([{ id: "c_aaaaaa", source: "1" }]),
      "m.jsnb": notebookText([{ id: "c_bbbbbb", source: "1" }]),
    });
    await withRemote(ws.dir, async ({ other }) => {
      await pushFrom(other, { "n.jsnb": notebookText([{ id: "c_aaaaaa", source: "theirs" }]) });
      await hook(ws.dir, "post-merge", "sleep 1.5");
      const daemon = await startDaemon(ws);
      const { client } = daemon;
      for (const path of ["n.jsnb", "m.jsnb"]) await client.notebook.open({ path });
      const pulling = client.git.pull({});
      await later(500);
      await client.cell.update({ notebook: "n.jsnb", cell: "c_aaaaaa", source: "typed" });
      await client.cell.update({ notebook: "m.jsnb", cell: "c_bbbbbb", source: "typed" });
      expect(await pulling).toMatchObject({ result: "fastForward" });
      const n = await client.cell.get({ notebook: "n.jsnb", cell: "c_aaaaaa" });
      expect(n.cell.source).toBe("typed");
      expect(await readFile(ws.path("n.jsnb"), "utf8")).toContain("theirs");
      await until(() => daemon.events.all().some((event) => event.type === "notebook.conflict"));
      const m = await client.cell.get({ notebook: "m.jsnb", cell: "c_bbbbbb" });
      expect(m.cell.source).toBe("typed");
      await until(() => readFileSync(ws.path("m.jsnb"), "utf8").includes("typed"));
    });
  });
});

it("reads a changed notebook again when nothing was edited during the operation", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "n.jsnb": notebookText([{ id: "c_aaaaaa", source: "1" }]) });
    await withRemote(ws.dir, async ({ other }) => {
      await pushFrom(other, { "n.jsnb": notebookText([{ id: "c_aaaaaa", source: "theirs" }]) });
      const { client } = await startDaemon(ws);
      await client.notebook.open({ path: "n.jsnb" });
      await client.git.pull({});
      const { cell } = await client.cell.get({ notebook: "n.jsnb", cell: "c_aaaaaa" });
      expect(cell.source).toBe("theirs");
    });
  });
});

it("cancels a write whose hook is slow, says busy naming it meanwhile, and leaves no lock", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    await hook(ws.dir, "pre-commit", "sleep 30");
    await writeFile(ws.path("a.txt"), "b\n");
    const { client, events } = await startDaemon(ws);
    const committing = client.git.commit({ message: "m", all: true }).catch((e: unknown) => e);
    await later(400);
    await expect(client.git.stage({ paths: ["a.txt"] })).rejects.toMatchObject({
      data: { reason: "busy", message: expect.stringContaining("git commit") as unknown },
    });
    expect((await client.git.status({})).running).toBe("commit");
    expect(await client.git.cancel({})).toEqual({ cancelled: "commit" });
    expect(await committing).toMatchObject({ data: { reason: "cancelled" } });
    expect(await exists(ws.path(".git", "index.lock"))).toBe(false);
    expect(
      events.all().some((e) => e.type === "git.running" && e.data.operation === "commit"),
    ).toBe(true);
    await client.git.stage({ paths: ["a.txt"] });
  });
});

it("cancels a merging pull and leaves a repository abort and status can work with", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    await withRemote(ws.dir, async ({ other }) => {
      await pushFrom(other, { "b.txt": "b\n" });
      await writeFile(ws.path("c.txt"), "c\n");
      sh(ws.dir, "add", "c.txt");
      sh(ws.dir, "commit", "-q", "-m", "mine");
      sh(ws.dir, "config", "pull.rebase", "false");
      await hook(ws.dir, "prepare-commit-msg", "sleep 30");
      const { client } = await startDaemon(ws);
      const pulling = client.git.pull({}).catch((e: unknown) => e);
      await later(800);
      await client.git.cancel({});
      expect(await pulling).toMatchObject({ data: { reason: "cancelled" } });
      expect(await exists(ws.path(".git", "index.lock"))).toBe(false);
      const { repo } = await client.git.status({});
      if (repo?.state === "merging") await client.git.abort({ confirm: true });
      expect((await client.git.status({})).repo?.state).toBe("clean");
    });
  });
});

it("never reads or stages a file inside .git, by any spelling or link, and takes a name starting with -", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "-lead.txt": "a\n" });
    sh(ws.dir, "config", "http.extraHeader", "Authorization: Bearer s3cr3t");
    await symlink(".git", ws.path("link"));
    const { client } = await startDaemon(ws);
    for (const path of [
      ".git/config",
      ".GIT/config",
      ".g‌it/config",
      "git~1/config",
      "link/config",
    ]) {
      const failure: unknown = await client.git.diff({ path }).catch((e: unknown) => e);
      expect(failure, path).toMatchObject({ name: "InvalidParams" });
      expect(JSON.stringify(failure)).not.toContain("s3cr3t");
      await expect(client.git.stage({ paths: [path] }), path).rejects.toMatchObject({
        name: "InvalidParams",
      });
    }
    await writeFile(ws.path("-lead.txt"), "b\n");
    expect(await client.git.diff({ path: "-lead.txt" })).toMatchObject({ kind: "text" });
    await client.git.stage({ paths: ["-lead.txt"] });
    await client.git.unstage({ paths: ["-lead.txt"] });
    await client.git.discard({ paths: ["-lead.txt"], confirm: true });
    expect(await readFile(ws.path("-lead.txt"), "utf8")).toBe("a\n");
  });
});

it("puts the changes back when a Stash & Switch fails, and says so", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    sh(ws.dir, "branch", "other");
    const elsewhere = await mkdtemp(join(tmpdir(), "nimbo-worktree-"));
    try {
      sh(ws.dir, "worktree", "add", "-q", join(elsewhere, "wt"), "other");
      await writeFile(ws.path("a.txt"), "mine\n");
      const { client } = await startDaemon(ws);
      const failure: unknown = await client.git
        .switch({ branch: "other", stash: true })
        .catch((e: unknown) => e);
      expect(failure).toMatchObject({
        name: "GitFailed",
        message: expect.stringContaining("Your changes were put back.") as unknown,
      });
      expect(await readFile(ws.path("a.txt"), "utf8")).toBe("mine\n");
      expect((await client.git.stashList({})).stashes).toEqual([]);
    } finally {
      sh(ws.dir, "worktree", "remove", "--force", join(elsewhere, "wt"));
      await rm(elsewhere, { recursive: true, force: true });
    }
  });
});

it("refuses @{ names and init inside a bare repository, redacts a password with an @, ignores the daemon's GIT_DIR", async () => {
  expect(redact("fatal: https://user:p@ss@host/repo.git not found")).toBe(
    "fatal: https://***@host/repo.git not found",
  );
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    sh(ws.dir, "branch", "b");
    sh(ws.dir, "switch", "-q", "b");
    sh(ws.dir, "switch", "-q", "main");
    const { client } = await startDaemon(ws);
    await expect(client.git.branchRename({ name: "@{-1}", to: "x" })).rejects.toMatchObject({
      name: "InvalidParams",
    });
    const saved = process.env.GIT_DIR;
    process.env.GIT_DIR = "/nonexistent";
    try {
      expect((await client.git.status({})).repo?.branch.name).toBe("main");
    } finally {
      if (saved === undefined) Reflect.deleteProperty(process.env, "GIT_DIR");
      else process.env.GIT_DIR = saved;
    }
  });
  await withWorkspace(async (ws) => {
    sh(ws.dir, "init", "-q", "--bare");
    const { client } = await startDaemon(ws);
    await expect(client.git.init({})).rejects.toMatchObject({ data: { reason: "exists" } });
  });
});
