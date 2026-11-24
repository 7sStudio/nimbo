// @vitest-environment node
// The Home reducer against a live daemon: a workspace flow of what agents and the page do to the
// notebook list (create, open a second, a busy kernel, close, rename, delete) runs on a real daemon and kernel, and the
// state its workspace events reduce to must equal what the daemon itself reports: workspace.info's list and each open
// notebook's kernel.status. With NIMBO_RECORD=1 the log is written as the fixture homeReduce.test.ts replays
// (`pnpm --filter @jsnb/ui record:events`).
import { writeFile } from "node:fs/promises";

import type { Daemon } from "@jsnb/test-daemon";
import { withDaemon } from "@jsnb/test-daemon";
import { describe, expect, it } from "vitest";

import { homeFlow, homeProjection, replayHome } from "./fixtures/homeReplay.js";

const record = process.env.NIMBO_RECORD === "1";

/** What the daemon itself says the Home page shows now. */
async function reported(daemon: Daemon) {
  const { notebooks } = await daemon.client.workspace.info();
  const open = notebooks.filter((each) => each.open).map((each) => each.path);
  const kernels = await Promise.all(
    open.map(async (path) => {
      const { state } = await daemon.client.kernel.status({ notebook: path });
      return [path, state] as const;
    }),
  );
  return {
    notebooks: notebooks.map(({ path, open: isOpen }) => ({ path, open: isOpen })),
    kernels: Object.fromEntries(kernels),
  };
}

describe("the Home flow", () => {
  it("reduces to the workspace the daemon reports", async () => {
    await withDaemon(async (daemon) => {
      const start = await daemon.client.workspace.info();
      await homeFlow(daemon);
      const end = await reported(daemon);
      await daemon.events.until("notebooks.changed", (event) => event.data.notebooks.length === 2);
      const events = daemon.events.all();
      expect(homeProjection(replayHome(start.notebooks, events))).toEqual(end);
      if (!record) return;
      const lines = events.map((event) => `${JSON.stringify(event)}\n`).join("");
      await writeFile(new URL("./fixtures/home.jsonl", import.meta.url), lines);
      const recording = { start: start.notebooks, end };
      await writeFile(
        new URL("./fixtures/home.state.json", import.meta.url),
        `${JSON.stringify(recording, null, 2)}\n`,
      );
    });
  });
});
