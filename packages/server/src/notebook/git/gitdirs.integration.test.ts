// The repository's real git directories stay out of reach under any name (a separate git dir, a linked worktree's,
// a submodule's), a submodule diffs as the commits it records, a cancel never deletes a lock another git holds, and
// stopping the daemon ends a git write stuck in a hook.
import { execFileSync } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { expect, it } from "vitest";

import { startDaemon } from "../../fixtures/daemon.js";
import { isolateGit, makeRepo, sh } from "../../fixtures/git.js";

isolateGit();

const later = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

const refusedEverywhere = async (
  client: Awaited<ReturnType<typeof startDaemon>>["client"],
  path: string,
) => {
  const failure: unknown = await client.git.diff({ path }).catch((e: unknown) => e);
  expect(failure, path).toMatchObject({ name: "InvalidParams" });
  expect(JSON.stringify(failure)).not.toContain("s3cr3t");
  await expect(client.git.stage({ paths: [path] }), path).rejects.toMatchObject({
    name: "InvalidParams",
  });
  await expect(client.git.log({ path }), path).rejects.toMatchObject({ name: "InvalidParams" });
};

it("refuses a separate git dir under its own name and a linked worktree's through a link", async () => {
  await withWorkspace(async (ws) => {
    sh(ws.dir, "init", "-q", "-b", "main", "--separate-git-dir=store", ".");
    await writeFile(ws.path(".gitignore"), ".user-config/\n.jsnb/\nstore/\n");
    await writeFile(ws.path("a.txt"), "a\n");
    sh(ws.dir, "add", "-A");
    sh(ws.dir, "commit", "-q", "-m", "first");
    sh(ws.dir, "remote", "add", "origin", "https://user:s3cr3t@127.0.0.1:9/r.git");
    const { client } = await startDaemon(ws);
    await refusedEverywhere(client, "store/config");
    expect(await client.git.diff({ path: "a.txt" })).toMatchObject({ kind: "text" });
  });
  await withWorkspace(async (ws) => {
    const main = await mkdtemp(join(tmpdir(), "nimbo-main-"));
    try {
      await makeRepo(main, { "a.txt": "a\n" });
      sh(main, "config", "remote.origin.url", "https://user:s3cr3t@127.0.0.1:9/r.git");
      await rm(ws.dir, { recursive: true, force: true });
      sh(main, "worktree", "add", "-q", ws.dir, "-b", "wt");
      await symlink(join(main, ".git"), ws.path("peek"));
      await symlink(join(main, ".git", "worktrees"), ws.path("trees"));
      const { client } = await startDaemon(ws);
      await refusedEverywhere(client, "peek/config");
      await refusedEverywhere(client, "trees/wt/HEAD");
    } finally {
      await rm(main, { recursive: true, force: true });
    }
  });
});

it("refuses a submodule's git dir and diffs a submodule as the commits it records", async () => {
  await withWorkspace(async (ws) => {
    const base = await mkdtemp(join(tmpdir(), "nimbo-sub-"));
    try {
      const library = join(base, "library");
      await mkdir(library);
      await makeRepo(library, { "l.txt": "1\n" });
      await makeRepo(ws.dir, { "a.txt": "a\n" });
      sh(ws.dir, "-c", "protocol.file.allow=always", "submodule", "add", "-q", library, "lib");
      sh(ws.dir, "commit", "-q", "-m", "add lib");
      const recorded = sh(ws.dir, "rev-parse", "HEAD:lib").trim();
      await writeFile(join(ws.dir, "lib", "l.txt"), "2\n");
      sh(join(ws.dir, "lib"), "commit", "-q", "-am", "two");
      const moved = sh(join(ws.dir, "lib"), "rev-parse", "HEAD").trim();
      await symlink(join(ws.dir, ".git", "modules", "lib"), ws.path("mods"));
      const { client } = await startDaemon(ws);
      await refusedEverywhere(client, "lib/.git");
      await refusedEverywhere(client, "mods/config");
      expect(await client.git.diff({ path: "lib" })).toMatchObject({
        kind: "submodule",
        submodule: { before: recorded, after: moved },
      });
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});

it("leaves a lock another git holds when a cancel ends a fetch, names it, and removes the merge temporaries of the cancelled write", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    const remote = ws.path("hang.sh");
    await writeFile(remote, "#!/bin/sh\nsleep 30\n", { mode: 0o755 });
    sh(ws.dir, "remote", "add", "origin", `ext::${remote}`);
    sh(ws.dir, "config", "protocol.ext.allow", "always");
    const { client } = await startDaemon(ws);
    await writeFile(ws.path(".merge_file_old"), "kept");
    const fetching = client.git.fetch({}).catch((e: unknown) => e);
    await later(400);
    const lock = ws.path(".git", "index.lock");
    await writeFile(lock, ""); // a terminal's git, holding the index
    await writeFile(ws.path(".merge_file_abc123"), "x"); // as a killed merge leaves them
    await client.git.cancel({});
    expect(await fetching).toMatchObject({
      data: { reason: "cancelled", message: expect.stringContaining("index.lock") as unknown },
    });
    expect(await exists(lock)).toBe(true);
    expect(await exists(ws.path(".merge_file_abc123"))).toBe(false);
    expect(await exists(ws.path(".merge_file_old"))).toBe(true);
    await rm(lock);
  });
});

it("stops the daemon promptly when a git write is stuck in a hook, cancelling it", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    const hook = ws.path(".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\nsleep 60\n");
    await chmod(hook, 0o755);
    await writeFile(ws.path("a.txt"), "b\n");
    const daemon = await startDaemon(ws);
    const committing = daemon.client.git
      .commit({ message: "m", all: true })
      .catch((e: unknown) => e);
    await later(400);
    const started = Date.now();
    await daemon.stop();
    expect(Date.now() - started).toBeLessThan(8000);
    await committing;
    expect(await exists(ws.path(".git", "index.lock"))).toBe(false);
    expect(
      execFileSync("git", ["-C", ws.dir, "log", "--format=%s"], { encoding: "utf8" }).trim(),
    ).toBe("first");
  });
});
