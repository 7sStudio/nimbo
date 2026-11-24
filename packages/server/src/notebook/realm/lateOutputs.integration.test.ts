// A client run's late outputs, and what a page reports on a run that ended (04-kernel §5.3, 03-api §4.5; rounds 4 to
// 6). What a client cell's timer prints or throws after its run ended is reported by the page on the run's execution,
// and joins that run as a server run's late output does (cell.output, cell.outputs), its status left as it ended; the
// page sees no failure of its reports. A page that drops a run at a reset (realm.restart, kernel.restart { all })
// answers realm.execute before its `interrupted` report goes out whenever another report is ahead of it on its one
// report chain: runtime-web's reset runs the run's cleanups, flushes the run's pending console text as a report,
// queues `interrupted` behind it and answers at once. A cell whose cleanup writes to the console has text pending at
// every reset, so the real page in Chromium sends that order every time (ten times in ten for a cell
// that logged just before), and the daemon, which ended the run on the answer, drops the report: no page error, the run
// interrupted, the cell idle. The rest is what no real page sends, so a scripted page sends it, a
// stub named for that: a status on a run that ended is INVALID_PARAMS on `execution` (the run left as it was) while a
// late output on it is taken, and a status on a run a later run of its cell replaced is dropped.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { RealmExecute, realmAttach, realmDetach, realmReport } from "@jsnb/core";
import type { Daemon } from "../../fixtures/daemon.js";
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

const source =
  'setTimeout(() => console.log("later"))\nsetTimeout(() => {\n  throw new TypeError("late")\n})\n1'; // under test: timers after the run

describe("a client run's late outputs", () => {
  it("join the run after its status, as a server run's do, the page's reports all taken", async () => {
    await withDaemon(
      async (daemon) => {
        const book = await createNotebook(daemon);
        const page = await pages.open(daemon, book.notebook);
        const cell = await book.add(source, "client");
        const { execution } = await daemon.client.cell.run({ notebook: book.notebook, cell });
        expect([execution.status, valueOf(execution)]).toEqual(["ok", 1]);
        for (const kind of ["stream", "error"])
          await daemon.events.until(
            "cell.output",
            (event) => event.data.execution === execution.id && event.data.output.kind === kind,
          );
        const kept = (await daemon.client.cell.outputs({ notebook: book.notebook, cell }))
          .execution;
        expect(kept?.status).toBe("ok");
        expect(kept?.outputs.slice(1)).toEqual(
          expect.arrayContaining([
            { kind: "stream", stream: "stdout", text: "later\n" },
            expect.objectContaining({
              kind: "error",
              error: expect.objectContaining({ name: "TypeError", message: "late" }) as unknown,
            }),
          ]),
        );
        expect(page.errors).toEqual([]);
        await page.close();
      },
      { uiDir },
    );
  });
});

describe("a client run's late outputs after a reconnect", () => {
  it("are taken after the page's socket dropped and it attached again", async () => {
    await withDaemon(
      async (daemon) => {
        const book = await createNotebook(daemon);
        const { notebook } = book;
        const page = await pages.open(daemon, notebook);
        // a Pay button: its click handler logs once the run ended (the test clicks it)
        const cell = await book.add('window.pay = () => console.log("paid")\n1', "client");
        const { execution } = await daemon.client.cell.run({ notebook, cell });
        expect(execution.status).toBe("ok");
        // the socket drops: the daemon detaches the page, which keeps its runs and attaches again once it is back
        if (!page.attached.ok) throw new Error("the page did not attach");
        await daemon.client.call(realmDetach, { realmId: page.attached.realmId });
        await page.reattach();
        await page.page.evaluate("window.pay()");
        await daemon.events.until(
          "cell.output",
          (event) => event.data.execution === execution.id && event.data.output.kind === "stream",
        );
        const kept = (await daemon.client.cell.outputs({ notebook, cell })).execution;
        expect([kept?.status, kept?.outputs.at(-1), page.errors]).toEqual([
          "ok",
          { kind: "stream", stream: "stdout", text: "paid\n" },
          [],
        ]);
        await page.close();
      },
      { uiDir },
    );
  });
});

/** A client cell that waits for ever, its cleanup writing to the console: at a reset that text is pending. */
const waiting = 'dispose(() => console.log("cleaned up"))\nawait new Promise(() => {})'; // under test: a run dropped

const resets = [
  [
    "realm.restart",
    (daemon: Daemon, notebook: string) => daemon.client.realm.restart({ notebook }),
  ],
  [
    "kernel.restart { all }",
    (daemon: Daemon, notebook: string) => daemon.client.kernel.restart({ notebook, all: true }),
  ],
] as const;

describe("a real page that drops a run at a reset", () => {
  it.each(resets)(
    "after %s, reports its end after its answer, with no page error",
    async (_, reset) => {
      await withDaemon(
        async (daemon) => {
          const book = await createNotebook(daemon);
          const { notebook } = book;
          const page = await pages.open(daemon, notebook);
          const cell = await book.add(waiting, "client");
          const run = daemon.client.cell.run({ notebook, cell });
          await daemon.events.until(
            "cell.status",
            (e) => e.data.cell === cell && e.data.status === "running",
          );
          await reset(daemon, notebook);
          const { execution } = await run;
          const after = (await daemon.client.cell.get({ notebook, cell })).cell;
          const next = await book.add("1 + 1", "client"); // its reports queue behind the dropped run's on the page
          const ran = (await daemon.client.cell.run({ notebook, cell: next })).execution;
          await page.page.evaluate("0"); // every error the page raised before is in
          expect([
            execution.status,
            after.status,
            after.lastExecution,
            valueOf(ran),
            page.errors,
          ]).toEqual(["interrupted", "idle", null, 2, []]);
          await page.close();
        },
        { uiDir },
      );
    },
  );
});

/**
 * A scripted page attached to `notebook` that reports each run `ok` before its answer: a stub, for the reports no real
 * page sends (a status on a run that ended, or on one a later run of its cell replaced).
 */
async function scriptedPage(daemon: Daemon, notebook: string) {
  const page = daemon.socket({ client: "ui" });
  let realmId = "";
  page.handle("realm.execute", async (params) => {
    const { execution } = RealmExecute.parse(params);
    await page.call(realmReport, { realmId, execution, status: "ok", durationMs: 1 });
    return {};
  });
  ({ realmId } = await page.call(realmAttach, { notebook, kind: "tab" }));
  return { page, realmId };
}

describe("a report on a client run that ended", () => {
  it("is refused with a status, taken with an output, the run left as it ended", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const { page, realmId } = await scriptedPage(daemon, notebook);
      const cell = await book.add("1 + 1", "client");
      const { execution } = await daemon.client.cell.run({ notebook, cell });
      expect(execution.status).toBe("ok");
      const late = { realmId, execution: execution.id };
      await expect(page.call(realmReport, { ...late, status: "error" })).rejects.toMatchObject({
        code: -32602,
        data: { issues: [{ path: ["execution"] }] },
      });
      await page.call(realmReport, {
        ...late,
        output: { kind: "stream", stream: "stdout", text: "x\n" },
      });
      const kept = (await daemon.client.cell.outputs({ notebook, cell })).execution;
      expect([kept?.status, kept?.outputs]).toEqual([
        "ok",
        [{ kind: "stream", stream: "stdout", text: "x\n" }],
      ]);
    });
  });

  it("is dropped, a status too, once a later run of its cell replaced it", async () => {
    await withDaemon(async (daemon) => {
      const book = await createNotebook(daemon);
      const { notebook } = book;
      const { page, realmId } = await scriptedPage(daemon, notebook);
      const cell = await book.add("1 + 1", "client");
      const first = (await daemon.client.cell.run({ notebook, cell })).execution;
      const second = (await daemon.client.cell.run({ notebook, cell })).execution;
      const late = { realmId, execution: first.id, status: "error" as const, durationMs: 5 };
      await expect(page.call(realmReport, late)).resolves.toEqual({});
      const last = (await daemon.client.cell.outputs({ notebook, cell })).execution;
      expect([last?.id, last?.status]).toEqual([second.id, "ok"]);
    });
  });
});
