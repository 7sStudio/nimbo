// The Source Control writes against the real git, each checked with git itself: stage, unstage,
// discard and commit, a pre-commit hook's failure, an open notebook reloaded after a discard, and git.changed after a
// commit made in a terminal.
import { chmod, readFile, writeFile } from "node:fs/promises";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { expect, it } from "vitest";

import { startDaemon } from "../../fixtures/daemon.js";
import { isolateGit, makeRepo, notebookText, sh, until } from "../../fixtures/git.js";

isolateGit();

const cachedNames = (dir: string) => sh(dir, "diff", "--cached", "--name-only").trim();

it("stages and unstages names taken literally, discards a tracked and an untracked file", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, {
      "a.txt": "a\n",
      "b.txt": "b\n",
      "glob[1].txt": "g\n",
      "g1.txt": "1\n",
    });
    for (const name of ["a.txt", "b.txt", "glob[1].txt", "g1.txt"])
      await writeFile(ws.path(name), "changed\n");
    await writeFile(ws.path("new.txt"), "n\n");
    const { client } = await startDaemon(ws);
    await client.git.stage({ paths: ["a.txt", "glob[1].txt"] });
    expect(cachedNames(ws.dir)).toBe("a.txt\nglob[1].txt");
    await client.git.unstage({ paths: ["glob[1].txt"] });
    expect(cachedNames(ws.dir)).toBe("a.txt");
    await client.git.discard({ paths: ["b.txt", "new.txt"], confirm: true });
    expect(await readFile(ws.path("b.txt"), "utf8")).toBe("b\n");
    await expect(readFile(ws.path("new.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

it("commits the index, refuses an empty commit, and commits everything with all", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n", "b.txt": "b\n" });
    await writeFile(ws.path("a.txt"), "a2\n");
    await writeFile(ws.path("b.txt"), "b2\n");
    const { client } = await startDaemon(ws);
    await client.git.stage({ paths: ["a.txt"] });
    const done = await client.git.commit({ message: "change a" });
    expect(done.branch).toBe("main");
    expect(done.oid).toBe(sh(ws.dir, "rev-parse", "HEAD").trim());
    expect(done.summary).toMatch(/^\[main [0-9a-f]+\] change a$/u);
    expect(sh(ws.dir, "show", "--name-only", "--format=%s", "HEAD").trim()).toBe(
      "change a\n\na.txt",
    );
    await expect(client.git.commit({ message: "nothing" })).rejects.toMatchObject({
      name: "GitFailed",
    });
    await client.git.commit({ message: "all of it", all: true });
    expect(sh(ws.dir, "status", "--porcelain").trim()).toBe("");
  });
});

it("brings a failing pre-commit hook's message back to the caller", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    const hook = ws.path(".git", "hooks", "pre-commit");
    await writeFile(hook, "#!/bin/sh\necho 'lint failed: a.txt' >&2\nexit 1\n");
    await chmod(hook, 0o755);
    await writeFile(ws.path("a.txt"), "a2\n");
    const { client } = await startDaemon(ws);
    await expect(client.git.commit({ message: "m", all: true })).rejects.toMatchObject({
      name: "GitFailed",
      message: expect.stringContaining("lint failed: a.txt") as unknown,
    });
  });
});

it("reloads an open notebook after a discard, and announces a commit made in a terminal", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, {
      "n.jsnb": notebookText([{ id: "c_aaaaaa", source: "const a = 1;" }]),
    });
    const daemon = await startDaemon(ws);
    const { client } = daemon;
    await client.notebook.open({ path: "n.jsnb" });
    await client.cell.update({ notebook: "n.jsnb", cell: "c_aaaaaa", source: "const a = 2;" });
    await client.git.discard({ paths: ["n.jsnb"], confirm: true });
    const { cell } = await client.cell.get({ notebook: "n.jsnb", cell: "c_aaaaaa" });
    expect(cell.source).toBe("const a = 1;");
    expect(await readFile(ws.path("n.jsnb"), "utf8")).toContain("const a = 1;");
    await writeFile(ws.path("other.txt"), "o\n");
    sh(ws.dir, "add", "other.txt");
    const staged = () =>
      daemon.events.all().some((e) => e.type === "git.changed" && e.data.counts.staged === 1);
    await until(staged);
    sh(ws.dir, "commit", "-q", "-m", "outside");
    const seen = daemon.events.all().length;
    await until(() =>
      daemon.events
        .all()
        .slice(seen)
        .some((e) => e.type === "git.changed" && e.data.counts.staged === 0),
    );
  });
});
