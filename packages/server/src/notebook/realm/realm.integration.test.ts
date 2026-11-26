// The daemon's side of the client realm through a real page: Chromium loads the test
// page from the daemon's /ui/, runtime-web's Realm attaches over the page's socket, and client cells run there with
// the server's exports as stubs and copies; the daemon proves NotExported, the page's names, the public env.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withDaemon } from "../../fixtures/daemon.js";
import type { RealmPages } from "@jsnb/test-tools/realm";
import { buildRealmPage, startRealmPages } from "@jsnb/test-tools/realm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createNotebook, valueOf } from "../../fixtures/notebook.js";

let uiDir: string;
let pages: RealmPages;
beforeAll(async () => {
  uiDir = await mkdtemp(join(tmpdir(), "nimbo-realm-page-"));
  await buildRealmPage(uiDir);
  pages = await startRealmPages();
});
afterAll(async () => {
  await pages.close();
  await rm(uiDir, { recursive: true, force: true });
});

describe("a client cell on the attached page", () => {
  it("runs there with the server's exports: a function as a stub, plain data as a copy", async () => {
    await withDaemon(
      async (daemon) => {
        const book = await createNotebook(daemon);
        const { notebook } = book;
        await book.ran(
          "export const price = 42\nexport function double(n: number) { return n * 2 }",
        );
        const page = await pages.open(daemon, notebook);
        expect(page.attached).toMatchObject({ ok: true });
        await daemon.events.until("realm.status", (e) => e.data.attached);
        const client = await book.add("const doubled = await double(price)\ndoubled + 1", "client");
        const { execution } = await daemon.client.cell.run({ notebook, cell: client });
        expect(execution).toMatchObject({ status: "ok" });
        expect(valueOf(execution)).toBe(85);
        const { bindings } = await daemon.client.cell.bindings({ notebook, cell: client });
        expect(bindings).toMatchObject([{ name: "doubled", definedBy: client, kind: "const" }]);
        const scope = await daemon.client.kernel.scope({ notebook, realm: "client" });
        expect(scope.bindings.map((binding) => binding.name)).toEqual(["doubled"]);
        expect(page.errors).toEqual([]);
        await page.close();
      },
      { uiDir },
    );
  });
});

describe("notebook.run of a server cell and a client cell using its export", () => {
  it("runs the client cell with the export the server cell just made: a server run ends once its exports are in", async () => {
    await withDaemon(
      async (daemon) => {
        const book = await createNotebook(daemon);
        await book.add("export const made = [1, 2, 3]");
        const client = await book.add("made.length", "client");
        const page = await pages.open(daemon, book.notebook);
        const { executions } = await daemon.client.notebook.run({
          notebook: book.notebook,
          select: "all",
        });
        expect(executions.map((execution) => execution.status)).toEqual(["ok", "ok"]);
        expect(valueOf(executions.find((execution) => execution.cell === client))).toBe(3);
        await page.close();
      },
      { uiDir },
    );
  });
});

describe("a client cell using a server name that is not exported", () => {
  it("ends in error with NotExported before the page runs anything", async () => {
    await withDaemon(
      async (daemon) => {
        const book = await createNotebook(daemon);
        await book.add("# notes", "markdown");
        const server = (await book.ran("const secretPrice = 7")).cell;
        const page = await pages.open(daemon, book.notebook);
        const client = await book.add("secretPrice * 2", "client");
        const { execution } = await daemon.client.cell.run({
          notebook: book.notebook,
          cell: client,
        });
        expect(execution).toMatchObject({ status: "error", outputs: [] });
        expect(execution.error).toMatchObject({
          name: "NotExported",
          data: { name: "secretPrice", cell: server, index: 2 },
        });
        await page.close();
      },
      { uiDir },
    );
  });
});

const env = { PUBLIC_KEY: "pk_1", SECRET_TOKEN: "supersecret1", PUBLIC_LEAK: "sk_test_abc" };

describe("the env of a client run", () => {
  it("holds the public names only, read again for every run, never a value that looks like a secret", async () => {
    await withDaemon(
      async (daemon) => {
        const book = await createNotebook(daemon);
        const page = await pages.open(daemon, book.notebook);
        const source = '[env.PUBLIC_KEY, env.has("SECRET_TOKEN"), env.has("PUBLIC_LEAK")]';
        const client = await book.add(source, "client");
        const first = await daemon.client.cell.run({ notebook: book.notebook, cell: client });
        expect(valueOf(first.execution)).toEqual(["pk_1", false, false]);
        await daemon.client.secrets.set({ name: "PUBLIC_KEY", value: "pk_2" });
        const second = await daemon.client.cell.run({ notebook: book.notebook, cell: client });
        expect(valueOf(second.execution)).toEqual(["pk_2", false, false]);
        await page.close();
      },
      { uiDir, files: { env } },
    );
  });
});

describe("the attached page", () => {
  it("is the first one: a second page is refused REALM_ATTACHED until the first one goes", async () => {
    await withDaemon(
      async (daemon) => {
        const book = await createNotebook(daemon);
        const first = await pages.open(daemon, book.notebook);
        const second = await pages.open(daemon, book.notebook);
        expect(second.attached).toEqual({ ok: false, name: "RealmAttached", code: 1011 });
        await first.close();
        await daemon.events.until("realm.status", (e) => !e.data.attached);
        const third = await pages.open(daemon, book.notebook);
        expect(third.attached).toMatchObject({ ok: true });
        expect(await daemon.client.realm.status({ notebook: book.notebook })).toMatchObject({
          attached: true,
          kind: "tab",
        });
        await Promise.all([second.close(), third.close()]);
      },
      { uiDir },
    );
  });
});

describe("a page that takes over", () => {
  it("gets the notebook from the page that held it, which is told and runs nothing more", async () => {
    await withDaemon(
      async (daemon) => {
        const book = await createNotebook(daemon);
        const first = await pages.open(daemon, book.notebook);
        const second = await pages.open(daemon, book.notebook);
        expect(second.attached).toMatchObject({ ok: false, code: 1011 });
        const statuses: boolean[] = [];
        const seen = daemon.events.until("realm.status", (e) => {
          statuses.push(e.data.attached);
          return e.data.attached;
        });
        await second.takeOver();
        await seen;
        // the status names the new page at once: no moment without a page, so no third tab races in
        expect(statuses).toEqual([true]);
        await expect.poll(() => first.takenOver()).toBe(true);
        const cell = await book.add("document.title = 'second'; 2", "client");
        const { execution } = await daemon.client.cell.run({ notebook: book.notebook, cell });
        expect(valueOf(execution)).toBe(2);
        expect(await second.page.title()).toBe("second");
        expect(await first.page.title()).not.toBe("second");
        await Promise.all([first.close(), second.close()]);
      },
      { uiDir },
    );
  });
});

describe("an attached page that closes", () => {
  it("ends the client run it runs `interrupted`, and the run after it fails REALM_NOT_ATTACHED", async () => {
    await withDaemon(
      async (daemon) => {
        const book = await createNotebook(daemon);
        const page = await pages.open(daemon, book.notebook);
        const hang = await book.add("await new Promise(() => {})", "client");
        const run = await book.start(hang);
        await book.reaches(run.id, "running");
        await page.close();
        await book.reaches(run.id, "interrupted");
        await expect(
          daemon.client.cell.run({ notebook: book.notebook, cell: hang }),
        ).rejects.toMatchObject({
          code: 1004,
        });
      },
      { uiDir },
    );
  });
});
