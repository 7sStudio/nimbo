// Autosave's policy (files.autoSave) with fake timers over a real file: afterDelay waits for a pause but never past
// the max wait while changes keep coming, interval writes once per interval however many changes, and off and
// onFocusChange write only on notebook.save.
import { readFile, writeFile } from "node:fs/promises";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { quiet } from "../../fixtures/workspace.js";
import { createAutosaver } from "./autosave.js";
import type { AutosavePolicy } from "./autosaveApi.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
});
afterEach(() => {
  vi.useRealTimers();
});

const policy = (patch: Partial<AutosavePolicy>): AutosavePolicy => ({
  mode: "afterDelay",
  delayMs: 1000,
  maxWaitMs: 3000,
  intervalMs: 120_000,
  ...patch,
});

/** A saver over `a.jsnb` whose state is "v<n>" after the n-th change; `saved()` waits for its next write. */
async function saverIn(dir: string, path: string, rule: AutosavePolicy) {
  let state = 0;
  let waiting = Promise.withResolvers<true>();
  await writeFile(path, "v0\n");
  const saver = createAutosaver(
    {
      ...{ path, root: dir, ref: "a.jsnb", text: () => `v${String(state)}\n` },
      ...{ now: () => new Date(), log: quiet, policy: () => rule },
      events: {
        saved: () => {
          waiting.resolve(true);
          waiting = Promise.withResolvers<true>();
        },
        failed: () => undefined,
        conflict: () => undefined,
      },
    },
    { text: "v0\n", dirty: false },
  );
  const change = () => {
    state += 1;
    saver.touched();
  };
  /** The file once the next write has landed. */
  const saved = async () => {
    await waiting.promise;
    return readFile(path, "utf8");
  };
  return { saver, change, saved };
}

describe("autosave's policy", () => {
  it("afterDelay saves once the changes pause, and within the max wait while they go on", async () => {
    await withWorkspace(async (ws) => {
      const path = ws.path("a.jsnb");
      const { saver, change, saved } = await saverIn(ws.dir, path, policy({}));
      // a change every 500 ms: never a 1 s pause, so only the 3 s cap writes, with the sixth change's state
      for (let at = 0; at < 6; at += 1) {
        expect(await readFile(path, "utf8")).toBe("v0\n");
        change();
        await vi.advanceTimersByTimeAsync(500);
      }
      expect(await saved()).toBe("v6\n");
      change();
      await vi.advanceTimersByTimeAsync(900);
      expect(await readFile(path, "utf8")).toBe("v6\n"); // still inside the pause
      await vi.advanceTimersByTimeAsync(200);
      expect(await saved()).toBe("v7\n");
      saver.close();
    });
  });
});

describe("autosave's interval and manual policies", () => {
  it("interval writes once per interval", async () => {
    await withWorkspace(async (ws) => {
      const path = ws.path("a.jsnb");
      const timed = await saverIn(ws.dir, path, policy({ mode: "interval", intervalMs: 60_000 }));
      timed.change();
      await vi.advanceTimersByTimeAsync(30_000);
      timed.change();
      expect(await readFile(path, "utf8")).toBe("v0\n");
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await timed.saved()).toBe("v2\n");
      timed.saver.close();
    });
  });

  it("off and onFocusChange write only on save", async () => {
    await withWorkspace(async (ws) => {
      const path = ws.path("a.jsnb");
      for (const mode of ["off", "onFocusChange"] as const) {
        const manual = await saverIn(ws.dir, path, policy({ mode }));
        manual.change();
        await vi.advanceTimersByTimeAsync(600_000);
        expect(await readFile(path, "utf8")).toBe("v0\n");
        await manual.saver.save(false);
        expect(await readFile(path, "utf8")).toBe("v1\n");
        await writeFile(path, "v0\n");
        manual.saver.close();
      }
    });
  });
});
