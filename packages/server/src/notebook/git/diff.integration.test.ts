// git.diff against the real git: an open notebook's unsaved edit cell by cell, one cell, staged,
// against a base; the text fallback for conflict markers; binary and oversized files; the path and revision refusals.
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { expect, it } from "vitest";

import { startDaemon } from "../../fixtures/daemon.js";
import { isolateGit, makeRepo, notebookText, sh } from "../../fixtures/git.js";

isolateGit();

const threeCells = notebookText([
  { id: "c_aaaaaa", source: "const a = 1;" },
  { id: "c_bbbbbb", source: "const b = 2;" },
  { id: "c_cccccc", type: "markdown", source: "# Title" },
]);

it("diffs an open notebook's edits cell by cell, hunks only, and one cell with its full sources", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "n.jsnb": threeCells });
    const { client } = await startDaemon(ws);
    await client.notebook.open({ path: "n.jsnb" });
    await client.cell.update({ notebook: "n.jsnb", cell: "c_aaaaaa", source: "const a = 10;" });
    await client.cell.delete({ notebook: "n.jsnb", cell: "c_bbbbbb" });
    await client.cell.add({ notebook: "n.jsnb", type: "client", source: "show(1)" });
    const diff = await client.git.diff({ path: "n.jsnb" });
    expect(diff).toMatchObject({ kind: "notebook", from: "index", to: "worktree" });
    expect(diff.notebook?.stats).toMatchObject({ added: 1, removed: 1, modified: 1, unchanged: 1 });
    const modified = diff.notebook?.rows.find((row) => row.status === "modified");
    expect(modified?.after?.source).toBeUndefined();
    expect(modified?.changes.source).toMatchObject({ added: 1, removed: 1 });
    const one = await client.git.diff({ path: "n.jsnb", cell: "c_aaaaaa", content: true });
    expect(one.notebook?.rows).toHaveLength(1);
    expect(one.notebook?.rows[0]?.after?.source).toBe("const a = 10;");
    expect(one.before).toBe(threeCells);
    await expect(client.git.diff({ path: "n.jsnb", cell: "c_nothere" })).rejects.toMatchObject({
      name: "CellNotFound",
    });
  });
});

it("stages an open notebook's state, diffs the index against HEAD and a file against a base", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "n.jsnb": threeCells, "t.txt": "one\ntwo\n" });
    const { client } = await startDaemon(ws);
    await client.notebook.open({ path: "n.jsnb" });
    await client.cell.update({ notebook: "n.jsnb", cell: "c_aaaaaa", source: "const a = 10;" });
    await client.git.stage({ paths: ["n.jsnb"] });
    expect(sh(ws.dir, "show", ":n.jsnb")).toContain("const a = 10;");
    const staged = await client.git.diff({ path: "n.jsnb", staged: true });
    expect(staged).toMatchObject({
      from: "HEAD",
      to: "index",
      notebook: { stats: { modified: 1 } },
    });
    await writeFile(ws.path("t.txt"), "one\n2\n");
    const text = await client.git.diff({ path: "t.txt", base: "HEAD", content: true });
    expect(text).toMatchObject({
      kind: "text",
      from: "HEAD",
      before: "one\ntwo\n",
      after: "one\n2\n",
    });
    expect(text.text).toMatchObject({ added: 1, removed: 1 });
  });
});

it("falls back to text for a notebook with conflict markers, and names binary and oversized files", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "n.jsnb": notebookText([{ id: "c_aaaaaa", source: "x" }]) });
    await writeFile(ws.path("n.jsnb"), "<<<<<<< HEAD\n{}\n=======\n{}\n>>>>>>> other\n");
    await writeFile(ws.path("bin.dat"), Buffer.from([1, 0, 2, 3]));
    await writeFile(ws.path("big.txt"), "x".repeat(1024 * 1024 + 1));
    const { client } = await startDaemon(ws);
    const broken = await client.git.diff({ path: "n.jsnb" });
    expect(broken).toMatchObject({ kind: "text", reason: "notebookUnreadable" });
    expect(await client.git.diff({ path: "bin.dat" })).toMatchObject({
      kind: "binary",
      from: "none",
    });
    expect(await client.git.diff({ path: "big.txt" })).toMatchObject({ kind: "tooLarge" });
  });
});

it("refuses a path out of the workspace, a path or revision that reads as an option, and a link out", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "a.txt": "a\n" });
    const outside = await mkdtemp(join(tmpdir(), "nimbo-out-"));
    await symlink(outside, ws.path("out"));
    const { client } = await startDaemon(ws);
    const refused = { name: "InvalidParams" };
    for (const path of ["../x", "/etc/passwd", "-x", "out/file", "a/../../x"])
      await expect(client.git.diff({ path }), path).rejects.toMatchObject(refused);
    for (const base of ["-x", "--output=/tmp/x", "HEAD..main", "nothere"])
      await expect(client.git.diff({ path: "a.txt", base }), base).rejects.toMatchObject(refused);
    await expect(client.git.discard({ paths: ["../a.txt"] })).rejects.toMatchObject(refused);
    await rm(outside, { recursive: true });
  });
});

it("names a staged rename's old path, gives agents the changed rows only, and refuses a path git never saw", async () => {
  await withWorkspace(async (ws) => {
    await makeRepo(ws.dir, { "old.jsnb": threeCells, "a.txt": "a\nb\n" });
    sh(ws.dir, "mv", "old.jsnb", "new.jsnb");
    await writeFile(ws.path("a.txt"), "a\nB\nc\n");
    const { client } = await startDaemon(ws);
    const renamed = await client.git.diff({ path: "new.jsnb", staged: true });
    expect(renamed).toMatchObject({ renamedFrom: "old.jsnb", kind: "notebook" });
    expect(renamed.notebook?.rows).toEqual([]);
    expect(renamed.notebook?.stats.unchanged).toBe(3);
    expect(
      (await client.git.diff({ path: "new.jsnb", staged: true, content: true })).notebook?.rows,
    ).toHaveLength(3);
    // a file that ends in a newline: its last line is not an empty one
    expect((await client.git.diff({ path: "a.txt" })).text).toMatchObject({ added: 2, removed: 1 });
    await expect(client.git.diff({ path: "nothere.txt" })).rejects.toMatchObject({
      name: "InvalidParams",
    });
  });
});
