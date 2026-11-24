// The language worker's restarts: the real worker thread, terminated from outside as a
// crash would end it; started again once, then LanguageUnavailable while a second death is under a minute old.
import type { Worker } from "node:worker_threads";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { expect, test } from "vitest";

import type { WorkerTask } from "./protocol.js";
import { createLanguageWorker } from "./spawn.js";

const task: WorkerTask = {
  op: "diagnostics",
  snapshot: {
    notebook: "a.jsnb",
    cells: [{ id: "c_000001", type: "server", source: "const x: number = 'no';" }],
    env: { server: [], client: [] },
  },
};

test("a dead worker is started again once, then refused within the minute, then started again", async () => {
  await withWorkspace(async (ws) => {
    const started: Worker[] = [];
    let clock = 0;
    const worker = createLanguageWorker({
      root: ws.dir,
      fallbackTypeRoots: [],
      onStart: (thread) => started.push(thread),
      now: () => clock,
    });
    const answered = async () => {
      const lists = await worker.request(task);
      return Array.isArray(lists) ? lists.length : -1;
    };
    const kill = async () => {
      const exited = new Promise((resolve) => started.at(-1)?.once("exit", resolve));
      await started.at(-1)?.terminate();
      await exited;
    };
    try {
      expect(await answered()).toBe(1);
      await kill();
      expect(await answered()).toBe(1);
      expect(started).toHaveLength(2);
      await kill();
      await expect(worker.request(task)).rejects.toMatchObject({ name: "LanguageUnavailable" });
      clock = 61_000;
      expect(await answered()).toBe(1);
      expect(started).toHaveLength(3);
    } finally {
      await worker.stop();
    }
  });
});

test("a request in flight when the worker dies fails with LanguageUnavailable", async () => {
  await withWorkspace(async (ws) => {
    const started: Worker[] = [];
    const worker = createLanguageWorker({
      root: ws.dir,
      fallbackTypeRoots: [],
      onStart: (t) => started.push(t),
    });
    try {
      const pending = worker.request(task);
      await started[0]?.terminate();
      await expect(pending).rejects.toMatchObject({ name: "LanguageUnavailable" });
    } finally {
      await worker.stop();
    }
  });
});
