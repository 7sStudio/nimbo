// The debugger on client cells, against the real js-debug, the built kernel and the system's Chrome running the
// headless realm: a breakpoint that pauses the page on its TypeScript line, the stack, a scope's variable, a step, an
// evaluation that changes a cell's name, the resume; a condition; a `debugger;` statement; a client cell awaiting a
// server function paused past the bridge's timeout; an interrupt and a tab's takeover while the page is paused; a stop
// while paused that leaves no browser. Skipped, with the reason in its name, on a machine with no such browser.
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Execution } from "@jsnb/core";
import type { RealmPages } from "@jsnb/test-tools/realm";
import { buildHeadlessPage, buildRealmPage, startRealmPages } from "@jsnb/test-tools/realm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Daemon } from "../../fixtures/daemon.js";
import { withDaemon } from "../../fixtures/daemon.js";
import type { TestNotebook } from "../../fixtures/notebook.js";
import { createNotebook, valueOf } from "../../fixtures/notebook.js";
import { findBrowser } from "../../kernel/headless/executable.js";

const found = findBrowser(null).found;
const suite = found ? describe : describe.skip;
const skipped = found ? "" : " (skipped: no Chrome, Chromium or Edge on this machine)";

const terminal = new Set(["ok", "error", "interrupted"]);

/** The seq of the last event received: a wait for a pause after it ignores the pauses before. */
const mark = (daemon: Daemon): number => daemon.events.all().at(-1)?.seq ?? 0;

const pausedAt = (daemon: Daemon, since: number, cell: string, line?: number) =>
  daemon.events.until(
    "debug.paused",
    (e) => e.seq > since && e.data.cell === cell && (line === undefined || e.data.line === line),
    30_000,
  );

/** The pids of the headless browsers whose profile is in `workspace`. */
function browsersOf(workspace: string): number[] {
  const profile = join(workspace, ".jsnb", "headless", "profile-");
  return execFileSync("ps", ["-axww", "-o", "pid=,args="], { encoding: "utf8" })
    .split("\n")
    .filter(
      (line) => line.includes(profile) && !line.includes("--type=") && !line.includes("crashpad"),
    )
    .map((line) => Number.parseInt(line.trim(), 10));
}

/** Runs `cell` (a waiting run, which answers once the page pauses) and waits for its pause on `line`; `ended` is the
 * run's terminal status. */
async function runToPause(
  daemon: Daemon,
  book: TestNotebook,
  cell: string,
  at: { readonly cell?: string; readonly line?: number } = {},
): Promise<{ readonly answered: Execution; readonly ended: Promise<Execution> }> {
  const before = mark(daemon);
  const { notebook } = book;
  const answer = daemon.client.cell.run({ notebook, cell });
  await pausedAt(daemon, before, at.cell ?? cell, at.line);
  const { execution: answered } = await answer;
  const ended = (async () => {
    if (terminal.has(answered.status)) return answered;
    const done = await daemon.events.until(
      "cell.status",
      (e) => e.data.execution === answered.id && terminal.has(e.data.status),
      30_000,
    );
    return { ...answered, status: done.data.status };
  })();
  return { answered, ended };
}

async function stepTo(daemon: Daemon, step: () => Promise<unknown>, cell: string, line?: number) {
  const before = mark(daemon);
  await step();
  await pausedAt(daemon, before, cell, line);
}

/** A notebook with realm.headless on. */
async function headlessBook(daemon: Daemon): Promise<TestNotebook> {
  await daemon.client.settings.set({ key: "realm.headless", value: true });
  return createNotebook(daemon);
}

let uiDir: string;
let pages: RealmPages;
beforeAll(async () => {
  uiDir = await mkdtemp(join(tmpdir(), "nimbo-client-debug-page-"));
  await buildRealmPage(uiDir);
  await buildHeadlessPage(uiDir);
  pages = await startRealmPages();
});
afterAll(async () => {
  await pages.close();
  await rm(uiDir, { recursive: true, force: true });
});

const counting = [
  "const start: number = 20;",
  "let total = start;",
  "for (const step of [1, 2, 3]) total += step;",
  "const el = document.createElement('section');",
  "total * 2;",
];

suite(`a client cell in the debugger${skipped}`, { timeout: 90_000 }, () => {
  it("pauses on its TypeScript line, shows the stack and a variable, steps, evaluates and resumes", async () => {
    await withDaemon(
      async (daemon) => {
        const book = await headlessBook(daemon);
        const { notebook } = book;
        const cell = await book.add(counting.join("\n"), "client");
        const set = await daemon.client.debug.setBreakpoint({ notebook, cell, line: 2 });
        expect(set).toMatchObject({ realm: "client", verified: false });
        expect(set.reason).toBeUndefined();

        const run = await runToPause(daemon, book, cell, { line: 2 });
        expect(run.answered).toMatchObject({
          status: "running",
          timedOut: true,
          paused: { realm: "client", reason: "breakpoint", cell, line: 2 },
        });
        const state = await daemon.client.debug.state({ notebook });
        expect(state).toMatchObject({
          state: "paused",
          paused: { realm: "client", cell, line: 2 },
          realms: { client: "paused" },
          breakpoints: [{ cell, line: 2, realm: "client", verified: true }],
        });
        const stack = await daemon.client.debug.stack({ notebook });
        expect(stack.realm).toBe("client");
        expect(stack.frames.map((frame) => [frame.cell, frame.line])).toEqual([[cell, 2]]);
        const { scopes } = await daemon.client.debug.scope({ notebook });
        const names = scopes.find((scope) => scope.name === "Notebook")?.variables;
        expect(names?.find((each) => each.name === "start")).toMatchObject({ value: "20" });

        await stepTo(daemon, () => daemon.client.debug.stepOver({ notebook }), cell, 3);
        const read = await daemon.client.debug.evaluate({ notebook, expression: "total" });
        expect(read).toMatchObject({ realm: "client", repr: "20" });
        await daemon.client.debug.evaluate({ notebook, expression: "total = 100" });
        await daemon.client.debug.resume({ notebook });
        const ended = await run.ended;
        expect(ended.status).toBe("ok");
        const { execution } = await daemon.client.cell.outputs({ notebook, cell });
        expect(valueOf(execution)).toBe(212);
        expect((await daemon.client.debug.state({ notebook })).realms.client).toBe("running");
      },
      { uiDir },
    );
  });

  it("pauses on a condition in a loop, on a debugger; statement, and shows a DOM element", async () => {
    await withDaemon(
      async (daemon) => {
        const book = await headlessBook(daemon);
        const { notebook } = book;
        const loop = await book.add(
          ["let seen = 0;", "for (let i = 0; i < 6; i++) {", "  seen += i;", "}", "seen;"].join(
            "\n",
          ),
          "client",
        );
        await daemon.client.debug.setBreakpoint({
          notebook,
          cell: loop,
          line: 3,
          condition: "i === 4",
        });
        const hit = await runToPause(daemon, book, loop, { line: 3 });
        expect((await daemon.client.debug.evaluate({ notebook, expression: "i" })).repr).toBe("4");
        expect((await daemon.client.debug.evaluate({ notebook, expression: "seen" })).repr).toBe(
          "6",
        );
        await daemon.client.debug.resume({ notebook });
        expect((await hit.ended).status).toBe("ok");

        const stopping = await book.add(
          [
            "const node = document.createElement('section');",
            "node.id = 'here';",
            "debugger;",
            "node.id;",
          ].join("\n"),
          "client",
        );
        const stopped = await runToPause(daemon, book, stopping, { line: 3 });
        expect(stopped.answered.paused?.description).toMatch(/debugger/iu);
        const element = await daemon.client.debug.evaluate({ notebook, expression: "node" });
        expect(element.repr).toMatch(/<section id="here">/u);
        expect(element.ref).toBeGreaterThan(0);
        const { variables } = await daemon.client.debug.variables({ notebook, ref: element.ref });
        expect(variables.length).toBeGreaterThan(0);
        await daemon.client.debug.resume({ notebook });
        expect((await stopped.ended).status).toBe("ok");
      },
      { uiDir },
    );
  });

  it("lets a client cell's bridge call wait past its timeout while the server function is paused", async () => {
    await withDaemon(
      async (daemon) => {
        const book = await headlessBook(daemon);
        const { notebook } = book;
        await daemon.client.settings.set({ key: "bridge.rpcTimeoutMs", value: 1000 });
        const server = await book.add(
          ["export function twice(n: number) {", "  const out = n * 2;", "  return out;", "}"].join(
            "\n",
          ),
        );
        await daemon.client.cell.run({ notebook, cell: server });
        await daemon.client.debug.setBreakpoint({ notebook, cell: server, line: 2 });
        const client = await book.add("const got = await twice(21);\ngot;", "client");
        const run = await runToPause(daemon, book, client, { cell: server, line: 2 });
        expect(run.answered.paused).toMatchObject({ realm: "server", cell: server, line: 2 });
        expect((await daemon.client.debug.state({ notebook })).realms.server).toBe("paused");
        await new Promise((resolve) => setTimeout(resolve, 2500)); // past bridge.rpcTimeoutMs
        await daemon.client.debug.resume({ notebook });
        expect((await run.ended).status).toBe("ok");
        const { execution } = await daemon.client.cell.outputs({ notebook, cell: client });
        expect(valueOf(execution)).toBe(42);
      },
      { uiDir },
    );
  });
});

suite(`a paused page's end${skipped}`, { timeout: 90_000 }, () => {
  it("ends a paused run on interrupt, and gives a tab the realm while paused, the breakpoint unbound with its reason", async () => {
    await withDaemon(
      async (daemon) => {
        const book = await headlessBook(daemon);
        const { notebook } = book;
        const cell = await book.add(["let n = 1;", "n += 1;", "n;"].join("\n"), "client");
        await daemon.client.debug.setBreakpoint({ notebook, cell, line: 2 });

        const interrupted = await runToPause(daemon, book, cell, { line: 2 });
        await daemon.client.kernel.interrupt({ notebook });
        expect((await interrupted.ended).status).toBe("interrupted");
        expect((await daemon.client.debug.state({ notebook })).realms.client).not.toBe("paused");

        const taken = await runToPause(daemon, book, cell, { line: 2 });
        const tab = await pages.open(daemon, notebook);
        expect(tab.attached).toMatchObject({ ok: true });
        const ended = await taken.ended;
        expect(ended.status).toBe("interrupted");
        const { execution } = await daemon.client.cell.outputs({ notebook, cell });
        expect(execution?.error?.message).toMatch(/another tab took/u);
        const state = await daemon.client.debug.state({ notebook });
        expect(state).toMatchObject({ paused: null, realms: { client: "off" } });
        expect(state.breakpoints[0]).toMatchObject({ verified: false, realm: "client" });
        expect(state.breakpoints[0]?.reason).toMatch(/A tab holds the client realm/u);
        await tab.close();
      },
      { uiDir },
    );
  });

  it("leaves no browser when the daemon stops while the page is paused", async () => {
    let workspace = "";
    await withDaemon(
      async (daemon) => {
        workspace = daemon.server.workspace;
        const book = await headlessBook(daemon);
        const cell = await book.add("let x = 1;\ndebugger;\nx;", "client");
        await runToPause(daemon, book, cell, { line: 2 });
        expect(browsersOf(workspace)).toHaveLength(1);
      },
      { uiDir },
    );
    expect(browsersOf(workspace)).toEqual([]);
  });
});
