// A change that lands while a save writes: the autosaver over a real file, whose
// state changes right after a write took its text, during that write's own reads and writes. The write does not mark
// the state saved: `dirty` stays true until a later write holds the change, and a close (flush) writes until the file
// holds the last state, as a save that found the file unchanged does too. A reload asked for while a write is under way
// (notebook.reload's read, in the queue of the file's writes) reads the file that write left.
import { dirname } from "node:path";
import { readFile, writeFile } from "node:fs/promises";

import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { quiet } from "../../fixtures/workspace.js";
import type { Autosaver } from "./autosave.js";
import { createAutosaver } from "./autosave.js";

type Notebook = { state: string; readonly saver: Autosaver };

/** An autosaver of `path` whose state becomes `next` (a mutation) right after a write takes the text, once. */
function changingOnce(path: string, initial: string, next: string): Notebook {
  let pending: string | undefined = next;
  const notebook: Notebook = {
    state: initial,
    saver: createAutosaver(
      {
        path,
        root: dirname(path),
        ref: "a.jsnb",
        now: () => new Date(0),
        log: quiet,
        text: () => {
          const taken = notebook.state;
          const change = pending;
          pending = undefined;
          if (change !== undefined) {
            queueMicrotask(() => {
              notebook.state = change; // lands while the write that took `taken` reads and writes the file
              notebook.saver.touched();
            });
          }
          return taken;
        },
        events: { saved: () => undefined, failed: () => undefined, conflict: () => undefined },
      },
      { text: initial, dirty: false },
    ),
  };
  return notebook;
}

describe("a change that lands while a save writes", () => {
  it("stays dirty after that write, and a close writes it", async () => {
    await withWorkspace(async (ws) => {
      const path = ws.path("a.jsnb");
      await writeFile(path, "v0\n");
      const notebook = changingOnce(path, "v0\n", "v2\n");
      notebook.state = "v1\n";
      notebook.saver.touched();
      await notebook.saver.save(false);
      expect(await readFile(path, "utf8")).toBe("v1\n");
      expect(notebook.saver.state().dirty).toBe(true);
      await notebook.saver.flush();
      notebook.saver.close();
      expect([await readFile(path, "utf8"), notebook.saver.state().dirty]).toEqual(["v2\n", false]);
    });
  });

  it("stays dirty after a save that found the file unchanged, and a close writes it", async () => {
    await withWorkspace(async (ws) => {
      const path = ws.path("a.jsnb");
      await writeFile(path, "v0\n");
      const notebook = changingOnce(path, "v0\n", "v1\n");
      notebook.saver.touched(); // a mutation that leaves the text as it is
      await notebook.saver.save(false);
      expect([await readFile(path, "utf8"), notebook.saver.state().dirty]).toEqual(["v0\n", true]);
      await notebook.saver.flush();
      notebook.saver.close();
      expect(await readFile(path, "utf8")).toBe("v1\n");
    });
  });
});

/** An autosaver of `path` that, right after a write takes the text, asks for a reload (the read of notebook.reload). */
function reloadingDuringWrite(path: string, initial: string) {
  const seen: { read?: string } = {};
  const notebook: Notebook = {
    state: initial,
    saver: createAutosaver(
      {
        path,
        root: dirname(path),
        ref: "a.jsnb",
        now: () => new Date(0),
        log: quiet,
        text: () => {
          if (seen.read === undefined) {
            seen.read = "";
            queueMicrotask(() => {
              // Lands while the write reads and writes the file, as notebook.reload does when it comes then.
              void notebook.saver.exclusive(async () => {
                seen.read = await readFile(path, "utf8");
                notebook.state = seen.read;
                notebook.saver.reloaded(seen.read, false);
              });
            });
          }
          return notebook.state;
        },
        events: { saved: () => undefined, failed: () => undefined, conflict: () => undefined },
      },
      { text: initial, dirty: false },
    ),
  };
  return { notebook, seen };
}

describe("a reload asked for while a save writes", () => {
  it("reads the file that write left, and the next save finds no conflict", async () => {
    await withWorkspace(async (ws) => {
      const path = ws.path("a.jsnb");
      await writeFile(path, "v0\n");
      const { notebook, seen } = reloadingDuringWrite(path, "v0\n");
      notebook.state = "v1\n";
      notebook.saver.touched();
      await notebook.saver.save(false);
      await notebook.saver.exclusive(() => Promise.resolve()); // the reload ran
      expect([seen.read, notebook.saver.state()]).toMatchObject([
        "v1\n",
        { dirty: false, conflict: false },
      ]);
      notebook.state = "v2\n";
      notebook.saver.touched();
      await notebook.saver.save(false);
      notebook.saver.close();
      expect(await readFile(path, "utf8")).toBe("v2\n");
    });
  });
});
