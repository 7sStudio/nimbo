// Autosave's retry every 10 s (07-file-format §5) with fake timers over a real file: a write the folder refuses is
// reported, tried again 10 s later without any mutation, and saved once the folder takes writes again.
import { chmod, readFile, writeFile } from "node:fs/promises";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { quiet } from "../../fixtures/workspace.js";
import { createAutosaver } from "./autosave.js";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});
afterEach(() => {
  vi.useRealTimers();
});

/** The next call of an event, as a promise. */
function next<T>(): { readonly hear: (value: T) => void; readonly heard: () => Promise<T> } {
  let waiting = Promise.withResolvers<T>();
  return {
    hear: (value) => {
      waiting.resolve(value);
    },
    heard: async () => {
      const value = await waiting.promise;
      waiting = Promise.withResolvers<T>();
      return value;
    },
  };
}

describe("autosave after a failed write", () => {
  it("tries again every 10 s without a mutation, and saves once the folder takes writes", async () => {
    await withWorkspace(async (ws) => {
      const path = ws.path("a.jsnb");
      await writeFile(path, "before\n");
      const failed = next<{ readonly code: string }>();
      const saved = next<string>();
      const saver = createAutosaver(
        {
          path,
          root: ws.dir,
          ref: "a.jsnb",
          text: () => "after\n",
          now: () => new Date(0),
          log: quiet,
          events: { saved: saved.hear, failed: failed.hear, conflict: () => undefined },
        },
        { text: "before\n", dirty: false },
      );
      await chmod(ws.dir, 0o500); // the temp file beside the notebook cannot be created
      try {
        saver.touched();
        await vi.advanceTimersByTimeAsync(100);
        expect((await failed.heard()).code).toBe("EACCES");
        await vi.advanceTimersByTimeAsync(10_000);
        expect((await failed.heard()).code).toBe("EACCES");
      } finally {
        await chmod(ws.dir, 0o700);
      }
      await vi.advanceTimersByTimeAsync(10_000);
      await saved.heard();
      expect(await readFile(path, "utf8")).toBe("after\n");
      saver.close();
    });
  });
});
