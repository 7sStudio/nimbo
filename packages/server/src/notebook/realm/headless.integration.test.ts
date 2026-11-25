// The headless client realm (02-architecture §7, 05-bridge §6) against the system's real Chrome, Chromium or Edge: off
// by default (REALM_NOT_ATTACHED naming the setting), started lazily by a client run, a snapshot with its image, push
// events, a tab that takes over and is never taken back from, the browser closed with the notebook and the daemon (no
// process or profile left), a killed browser started again, a browser that cannot start not started in a loop. Skipped,
// with the reason in its name, on a machine with no such browser (some CI runners).
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

/** The pids of the headless browsers (not their helpers) whose profile is in `workspace`. */
function browsersOf(workspace: string): number[] {
  const profile = join(workspace, ".jsnb", "headless", "profile-");
  return execFileSync("ps", ["-axww", "-o", "pid=,args="], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.includes(profile) && !line.includes("--type="))
    .map((line) => Number.parseInt(line.trim(), 10));
}

const profilesOf = (workspace: string): string[] => {
  const dir = join(workspace, ".jsnb", "headless");
  return existsSync(dir) ? readdirSync(dir) : [];
};

async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const end = Date.now() + 10_000;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const drawing =
  'const box = display.div()\nbox.textContent = "drawn headless"\nbox.style.padding = "8px"\n40 + 2';

/** A notebook with one client cell drawing into its container, realm.headless on. */
async function headlessBook(daemon: Daemon): Promise<{ book: TestNotebook; cell: string }> {
  await daemon.client.settings.set({ key: "realm.headless", value: true });
  const book = await createNotebook(daemon);
  return { book, cell: await book.add(drawing, "client") };
}

const kindOf = async (daemon: Daemon, notebook: string) =>
  (await daemon.client.realm.status({ notebook })).kind;

let uiDir: string;
let pages: RealmPages;
beforeAll(async () => {
  uiDir = await mkdtemp(join(tmpdir(), "nimbo-headless-page-"));
  await buildRealmPage(uiDir);
  await buildHeadlessPage(uiDir);
  pages = await startRealmPages();
});
afterAll(async () => {
  await pages.close();
  await rm(uiDir, { recursive: true, force: true });
});

suite(`the headless realm off${skipped}`, () => {
  it("leaves a client run REALM_NOT_ATTACHED naming the setting, and starts no browser", async () => {
    await withDaemon(
      async (daemon) => {
        const book = await createNotebook(daemon);
        const cell = await book.add("1 + 1", "client");
        const run = daemon.client.cell.run({ notebook: book.notebook, cell });
        await expect(run).rejects.toMatchObject({ code: 1004 });
        await expect(run).rejects.toThrow(/turn on the setting realm\.headless/);
        expect(browsersOf(daemon.server.workspace)).toEqual([]);
      },
      { uiDir },
    );
  });
});

suite(`the headless realm on${skipped}`, { timeout: 60_000 }, () => {
  it("starts on the first client run, answers a snapshot and its image, and leaves nothing at stop", async () => {
    let workspace = "";
    await withDaemon(
      async (daemon) => {
        workspace = daemon.server.workspace;
        const { book, cell } = await headlessBook(daemon);
        const { notebook } = book;
        expect(browsersOf(workspace)).toEqual([]); // nothing starts before a need
        const { execution } = await daemon.client.cell.run({ notebook, cell });
        expect(valueOf(execution)).toBe(42);
        expect(await kindOf(daemon, notebook)).toBe("headless");
        expect(browsersOf(workspace)).toHaveLength(1);
        const shot = await daemon.client.cell.snapshot({ notebook, cell, image: true });
        expect(shot).toMatchObject({ text: "drawn headless", rendered: true });
        expect(shot.image).toMatchObject({ mime: "image/png", scale: 1, cropped: false });
        const png = Buffer.from(shot.image?.data ?? "", "base64");
        expect(png.subarray(1, 4).toString()).toBe("PNG");
        const small = await daemon.client.cell.snapshot({
          ...{ notebook, cell, image: true, imageMaxBytes: 4096 },
        });
        expect(Buffer.from(small.image?.data ?? "", "base64").length).toBeLessThanOrEqual(4096);
      },
      { uiDir },
    );
    expect(browsersOf(workspace)).toEqual([]);
    expect(profilesOf(workspace)).toEqual([]);
  });
});

suite(`the headless realm and push events${skipped}`, { timeout: 60_000 }, () => {
  it("delivers a server cell's events to a client cell's listener", async () => {
    await withDaemon(
      async (daemon) => {
        const { book } = await headlessBook(daemon);
        const { notebook } = book;
        const listener = await book.add(
          'const seen = display.div()\nseen.textContent = "none"\non("tick", ({ n }) => { seen.textContent = `tick ${n}` })',
          "client",
        );
        await daemon.client.cell.run({ notebook, cell: listener });
        await book.ran('for (let n = 1; n <= 3; n++) emit("tick", { n })');
        const read = async () =>
          (await daemon.client.cell.snapshot({ notebook, cell: listener })).text;
        await until(async () => (await read()) === "tick 3", "the third tick");
        const { events } = await daemon.client.bridge.events({ notebook });
        expect(events.find((each) => each.name === "tick")).toMatchObject({ delivered: 3 });
      },
      { uiDir },
    );
  });
});

suite(`the headless realm and a tab${skipped}`, { timeout: 60_000 }, () => {
  it("gives the realm to a tab, never takes it back while the tab is there, and comes back once it closed", async () => {
    await withDaemon(
      async (daemon) => {
        const workspace = daemon.server.workspace;
        const { book, cell } = await headlessBook(daemon);
        const { notebook } = book;
        await daemon.client.cell.run({ notebook, cell });
        const tab = await pages.open(daemon, notebook);
        expect(tab.attached).toMatchObject({ ok: true });
        expect(await kindOf(daemon, notebook)).toBe("tab");
        await until(() => browsersOf(workspace).length === 0, "the headless browser to close");
        await daemon.client.cell.run({ notebook, cell });
        await tab.untilText(cell, "drawn headless");
        const image = daemon.client.cell.snapshot({ notebook, cell, image: true });
        await expect(image).rejects.toMatchObject({ code: 1009 });
        expect(await kindOf(daemon, notebook)).toBe("tab");
        expect(browsersOf(workspace)).toEqual([]);
        await tab.close();
        await daemon.events.until("realm.status", (event) => !event.data.attached);
        await daemon.client.cell.run({ notebook, cell });
        expect(await kindOf(daemon, notebook)).toBe("headless");
        await daemon.client.notebook.close({ notebook });
        await until(
          () => browsersOf(workspace).length === 0,
          "the browser to close with the notebook",
        );
      },
      { uiDir },
    );
  });
});

suite(`a headless browser that goes or cannot start${skipped}`, { timeout: 60_000 }, () => {
  it("starts a killed browser again at the next need", async () => {
    await withDaemon(
      async (daemon) => {
        const { book, cell } = await headlessBook(daemon);
        const { notebook } = book;
        await daemon.client.cell.run({ notebook, cell });
        const [pid] = browsersOf(daemon.server.workspace);
        process.kill(pid ?? 0, "SIGKILL");
        await daemon.events.until("realm.status", (event) => !event.data.attached);
        const again = await daemon.client.cell.run({ notebook, cell });
        expect(again.execution).toMatchObject({ status: "ok" });
        expect(browsersOf(daemon.server.workspace)).not.toContain(pid);
      },
      { uiDir },
    );
  });

  it("does not start a browser that fails again at once: it waits a growing delay", async () => {
    await withDaemon(
      async (daemon) => {
        const { book, cell } = await headlessBook(daemon);
        await daemon.client.settings.set({ key: "realm.headlessBrowser", value: "/usr/bin/false" });
        const run = () => daemon.client.cell.run({ notebook: book.notebook, cell });
        await expect(run()).rejects.toThrow(/\/usr\/bin\/false did not start/);
        await expect(run()).rejects.toThrow(/It is tried again in 2 s\./);
      },
      { uiDir },
    );
  });
});
