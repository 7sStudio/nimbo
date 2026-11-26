// Saved outputs, compare and export through a real daemon (cell.compare and
// notebook.export): outputs.save writes each cell's last finished run into the file, redacted, and a reopened notebook
// shows it as a restored run that the next run is compared with; `never` writes none; an export lands inside the
// workspace and never outside it.
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cellCompare, notebookExport } from "@jsnb/core";
import { describe, expect, it } from "vitest";

import { withDaemon } from "../../fixtures/daemon.js";
import { createNotebook } from "../../fixtures/notebook.js";

const secret = "supersecretvalue1";

type Daemon = Parameters<Parameters<typeof withDaemon>[0]>[0];

/** A reopened notebook's restored run, then the next run compared with it. */
async function reopenAndCompare(daemon: Daemon, notebook: string, cell: string): Promise<void> {
  const { client } = daemon;
  await client.notebook.close({ notebook });
  await client.notebook.open({ path: notebook });
  const { execution } = await client.cell.outputs({ notebook, cell });
  expect(execution).toMatchObject({ status: "ok", restored: true });
  expect((await client.call(cellCompare, { notebook, cell })).comparison).toBeNull();

  await client.cell.run({ notebook, cell, source: "[{ id: 1, n: 'z' }, { id: 2, n: 'b' }]" });
  const compared = await client.call(cellCompare, { notebook, cell });
  expect(compared.previous?.restored).toBe(true);
  expect(compared.comparison?.value?.changes).toEqual([
    { kind: "changed", path: "$[0].n", before: "a", after: "z" },
  ]);
  expect(compared.comparison?.text.map((line) => line.kind)).toEqual(["removed"]);
}

describe("saved outputs", () => {
  it("are written redacted, restored on reopen and compared with the next run", async () => {
    await withDaemon(async (daemon, ws) => {
      const { client } = daemon;
      await client.secrets.set({ name: "SECRET_KEY", value: secret });
      await client.settings.set({ key: "outputs.save", value: "always" });
      const book = await createNotebook(daemon);
      const { cell } = await book.ran(
        "console.log('k', env.SECRET_KEY); [{ id: 1, n: 'a' }, { id: 2, n: 'b' }]",
      );
      await client.notebook.save({ notebook: book.notebook });
      const text = await readFile(ws.path(book.notebook), "utf8");
      const file = JSON.parse(text) as { outputs: Record<string, { status: string }> };
      expect(file.outputs[cell]?.status).toBe("ok");
      expect(text).not.toContain(secret);
      await reopenAndCompare(daemon, book.notebook, cell);
    });
  });
});

describe("the outputs.save policy", () => {
  it("leaves outputs out under never, and keeps a file's own under auto", async () => {
    await withDaemon(async (daemon, ws) => {
      const { client } = daemon;
      const book = await createNotebook(daemon);
      await book.ran("1 + 1");
      await client.notebook.save({ notebook: book.notebook, force: true });
      expect(await readFile(ws.path(book.notebook), "utf8")).not.toContain('"outputs"');

      // a file that has outputs keeps them under auto (the default)
      await client.notebook.close({ notebook: book.notebook });
      const raw = JSON.parse(await readFile(ws.path(book.notebook), "utf8")) as Record<
        string,
        unknown
      >;
      await writeFile(
        ws.path(book.notebook),
        `${JSON.stringify({ ...raw, outputs: {} }, null, 2)}\n`,
      );
      const opened = await client.notebook.open({ path: book.notebook });
      const cell = opened.notebook.cells[0]?.id ?? "";
      await client.cell.run({ notebook: book.notebook, cell });
      await client.notebook.save({ notebook: book.notebook });
      expect(await readFile(ws.path(book.notebook), "utf8")).toContain(`"${cell}": {`);

      await client.settings.set({ key: "outputs.save", value: "never" });
      await client.cell.run({ notebook: book.notebook, cell });
      await client.notebook.save({ notebook: book.notebook });
      expect(await readFile(ws.path(book.notebook), "utf8")).not.toContain('"outputs"');
    });
  });
});

describe("notebook.export", () => {
  it("writes a page with the outputs inside the workspace and refuses a path outside it", async () => {
    await withDaemon(async (daemon, ws) => {
      const { client } = daemon;
      const book = await createNotebook(daemon);
      await book.add("# Title\n\n<script>alert(1)</script>", "markdown");
      await book.ran("display.table([{ a: 1 }, { a: 2 }]); 'done'");
      const page = await client.call(notebookExport, {
        notebook: book.notebook,
        path: "out/page.html",
      });
      expect(page.path).toBe("out/page.html");
      const html = await readFile(ws.path("out/page.html"), "utf8");
      expect(html).toBe(page.html);
      expect(html).toContain("Content-Security-Policy");
      expect(html).toContain("<h1>Title</h1>");
      expect(html).not.toContain("<script>");
      expect(html).toContain("&quot;done&quot;");
      for (const path of ["../out.html", "/tmp/out.html", "page.txt"])
        await expect(
          client.call(notebookExport, { notebook: book.notebook, path }),
        ).rejects.toMatchObject({ name: "InvalidParams" });
    });
  });
});

describe("notebook.export through a link", () => {
  it("makes no folder outside the workspace", async () => {
    const away = await mkdtemp(join(tmpdir(), "nimbo-away-"));
    try {
      await withDaemon(async (daemon, ws) => {
        const book = await createNotebook(daemon);
        await symlink(away, ws.path("away"));
        await expect(
          daemon.client.call(notebookExport, {
            notebook: book.notebook,
            path: "away/made/page.html",
          }),
        ).rejects.toMatchObject({ name: "InvalidParams" });
        expect(await readdir(away)).toEqual([]);
      });
    } finally {
      await rm(away, { recursive: true, force: true });
    }
  });
});
