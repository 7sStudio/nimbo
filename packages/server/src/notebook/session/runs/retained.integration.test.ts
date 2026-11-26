// The full values the daemon retains: bounded per notebook by
// outputs.retainMaxBytes with the oldest dropped first, kept across a kernel restart, not kept at all with
// outputs.retainFullValue off (a value that was never cut is still served from its own json).
import type { Daemon } from "../../../fixtures/daemon.js";
import { withDaemon } from "../../../fixtures/daemon.js";
import { describe, expect, it } from "vitest";

import { createNotebook } from "../../../fixtures/notebook.js";

/** About 950 KB of JSON text. */
const rows = (n: number) =>
  `Array.from({ length: 20000 }, (_, i) => ({ i, n: ${String(n)}, text: 'x'.repeat(20) }))`;

const download = async (daemon: Daemon, execution: string): Promise<unknown> =>
  (await daemon.download({ execution, index: 0 })).json();

describe("retained full values within outputs.retainMaxBytes", () => {
  it("drop the oldest first, and survive a kernel restart", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.settings.set({ key: "outputs.retainMaxBytes", value: 2_000_000 }); // two values, not three
      const book = await createNotebook(daemon);
      const first = (await book.ran(rows(1))).execution.id;
      const second = (await book.ran(rows(2))).execution.id;
      expect(await download(daemon, first)).toHaveLength(20_000);
      const third = (await book.ran(rows(3))).execution.id;
      await expect(download(daemon, first)).rejects.toMatchObject({
        code: -32602,
        data: { issues: [{ path: ["index"] }] },
      });
      await daemon.client.kernel.restart({ notebook: book.notebook });
      expect(await download(daemon, second)).toHaveLength(20_000);
      expect(await download(daemon, third)).toHaveLength(20_000);
    });
  });
});

describe("outputs.retainFullValue off", () => {
  it("keeps no full value; a value never cut is still served from its own json", async () => {
    await withDaemon(async (daemon) => {
      await daemon.client.settings.set({ key: "outputs.retainFullValue", value: false });
      const book = await createNotebook(daemon);
      const big = (await book.ran(rows(1))).execution.id;
      const small = (await book.ran("({ ok: true })")).execution.id;
      await expect(download(daemon, big)).rejects.toMatchObject({ code: -32602 });
      expect(await download(daemon, small)).toEqual({ ok: true });
    });
  });
});
