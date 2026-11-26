// The bridge suite's world: a daemon of its own, a notebook, and the real page attached
// as its client realm (runtime-web's Realm in Chromium, @jsnb/test-tools/realm), so every bridge test runs the real
// kernel, the real daemon and the real page end to end; the run of a cell, its decoded value and its errors.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Execution } from "@jsnb/core";
import type { Daemon, DaemonOptions } from "./daemon.js";
import { withDaemon } from "./daemon.js";
import type { RealmPage, RealmPages } from "@jsnb/test-tools/realm";
import { buildRealmPage, startRealmPages, teardownMs } from "@jsnb/test-tools/realm";
import type { Workspace, WorkspaceOptions } from "@jsnb/test-tools/workspace";
import { afterAll, beforeAll } from "vitest";

import type { TestNotebook } from "./notebook.js";
import { createNotebook } from "./notebook.js";

export type BridgeWorld = {
  readonly daemon: Daemon;
  /** The daemon's workspace folder. */
  readonly workspace: Workspace;
  readonly book: TestNotebook;
  readonly notebook: string;
  /** The attached page; the world closes it after the test. */
  readonly page: RealmPage;
  /** Adds a server cell, runs it and answers its id once its run ended ok (its exports in). */
  readonly server: (source: string) => Promise<string>;
  /** Adds a client cell, not run. */
  readonly client: (source: string) => Promise<string>;
  /** cell.run, waiting for the terminal status. */
  readonly run: (cell: string) => Promise<Execution>;
};

type Options = DaemonOptions & { readonly files?: WorkspaceOptions };

export type BridgeSuite = {
  /** Runs `test` in a world of its own: a daemon, a notebook `a.jsnb`, the page attached to it. */
  readonly withBridge: (
    test: (world: BridgeWorld) => Promise<void>,
    options?: Options,
  ) => Promise<void>;
};

/** A notebook in `daemon` with the page from `pages` attached, and the helpers over it. */
async function worldOf(
  daemon: Daemon,
  workspace: Workspace,
  pages: RealmPages,
): Promise<BridgeWorld> {
  const book = await createNotebook(daemon);
  const { notebook } = book;
  const page = await pages.open(daemon, notebook);
  if (!page.attached.ok) throw new Error(`the page did not attach: ${page.attached.name}`);
  const run = async (cell: string) => (await daemon.client.cell.run({ notebook, cell })).execution;
  const server = async (source: string) => {
    const cell = await book.add(source);
    const execution = await run(cell);
    if (execution.status !== "ok") throw new Error(`the server cell ended ${execution.status}`);
    return cell;
  };
  const client = (source: string) => book.add(source, "client");
  return { daemon, workspace, book, notebook, page, server, run, client };
}

/** Builds the page once per file and starts one Chromium for the file's tests (beforeAll), and removes both after. */
export function bridgeSuite(): BridgeSuite {
  let uiDir = "";
  let pages: RealmPages | undefined;
  beforeAll(async () => {
    uiDir = await mkdtemp(join(tmpdir(), "nimbo-bridge-page-"));
    await buildRealmPage(uiDir);
    pages = await startRealmPages();
  });
  afterAll(async () => {
    await pages?.close();
    await rm(uiDir, { recursive: true, force: true });
  }, teardownMs);
  const inWorld =
    (test: (world: BridgeWorld) => Promise<void>) =>
    async (daemon: Daemon, workspace: Workspace) => {
      if (!pages) throw new Error("bridgeSuite's beforeAll has not run");
      const world = await worldOf(daemon, workspace, pages);
      try {
        await test(world);
      } finally {
        await world.page.close();
      }
    };
  return {
    withBridge: (test, options = {}) => withDaemon(inWorld(test), { ...options, uiDir }),
  };
}
