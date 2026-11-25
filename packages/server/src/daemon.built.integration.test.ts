// The built daemon and kernel (dist/, server:integration) run a cell: cell.run of `1 + 1` ends ok, an interrupt of
// `while (true) {}` ends the run interrupted, and notebook.open starts the kernel to idle.
import type { Connected } from "./fixtures/daemon.js";
import { connectDaemon } from "./fixtures/daemon.js";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { readServerJson, spawnBuiltDaemon } from "./fixtures/builtDaemon.js";

/** Runs `fn` with clients of a built daemon over a fresh workspace. */
async function withBuiltDaemon(fn: (daemon: Connected) => Promise<void>) {
  await withWorkspace(async (ws) => {
    const process = spawnBuiltDaemon(ws);
    const { url } = await process.listening;
    const daemon = await connectDaemon({ url, token: (await readServerJson(ws)).token });
    try {
      await fn(daemon);
    } finally {
      daemon.close();
      process.child.kill("SIGTERM");
      await process.exited;
    }
  });
}

describe("the built daemon", () => {
  it("runs 1 + 1 to ok", async () => {
    await withBuiltDaemon(async ({ client }) => {
      const notebook = "run.jsnb";
      await client.notebook.create({ path: notebook });
      const { cell } = await client.cell.add({ notebook, type: "server", source: "1 + 1" });
      expect((await client.cell.run({ notebook, cell: cell.id })).execution.status).toBe("ok");
    });
  });

  it("ends a while (true) {} run interrupted", async () => {
    await withBuiltDaemon(async ({ client, events }) => {
      const notebook = "spin.jsnb";
      await client.notebook.create({ path: notebook });
      const { cell } = await client.cell.add({
        notebook,
        type: "server",
        source: "while (true) {}",
      });
      const { execution } = await client.cell.run({ notebook, cell: cell.id, wait: false });
      await events.until(
        "cell.status",
        (e) => e.data.execution === execution.id && e.data.status === "running",
      );
      await client.kernel.interrupt({ notebook });
      await events.until(
        "cell.status",
        (e) => e.data.execution === execution.id && e.data.status === "interrupted",
      );
    });
  });

  it("starts the kernel to idle on notebook.open", async () => {
    await withBuiltDaemon(async ({ client, events }) => {
      const notebook = "start.jsnb";
      await client.notebook.create({ path: notebook });
      await client.notebook.close({ notebook });
      const before = events.all().length; // the create's own kernel start does not count
      await client.notebook.open({ path: notebook });
      await events.until(
        "kernel.status",
        (e) =>
          e.notebook === notebook && e.data.state === "idle" && events.all().indexOf(e) >= before,
      );
    });
  });
});
