// The `| head` cases as a shell user runs them, the built bin (dist/main.js) in a real bash
// pipeline into a real head, against a real daemon: the bin's own exit status (PIPESTATUS) is 0 and it writes nothing
// on stderr when head goes away early, for `outputs --format json`, `outputs --full` and `events --follow`.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Daemon } from "@jsnb/test-daemon";
import { withDaemon } from "@jsnb/test-daemon";
import type { Workspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../../dist/main.js", import.meta.url));

/** `node dist/main.js <args> | head <headArgs>` in bash, in `ws`; the bin's stderr in a file of the workspace. */
function pipeline(ws: Workspace, args: readonly string[], headArgs: string) {
  const script = `"$0" "$@" 2>"$NIMBO_TEST_ERR" | head ${headArgs} >/dev/null; exit "\${PIPESTATUS[0]}"`;
  const shell = spawn("bash", ["-c", script, process.execPath, bin, ...args], {
    cwd: ws.dir,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      XDG_CONFIG_HOME: ws.path(".user-config"),
      NIMBO_TEST_ERR: ws.path("bin-stderr.txt"),
    },
    stdio: "ignore",
  });
  const exited = once(shell, "exit").then(([code]: unknown[]) => code);
  return {
    exited,
    stderr: async (): Promise<string> => {
      try {
        return await readFile(ws.path("bin-stderr.txt"), "utf8");
      } catch {
        return ""; // not written yet
      }
    },
  };
}

/** A notebook whose one cell's value is about 3 MB, cut at the output limit, its whole value retained. */
async function bigValue(daemon: Daemon): Promise<string> {
  await daemon.client.notebook.create({ path: "demo.jsnb" });
  const source = 'Array.from({ length: 30000 }, (_, i) => ({ id: i, text: "x".repeat(100) }))';
  const added = await daemon.client.cell.add({
    notebook: "demo.jsnb",
    type: "server",
    source,
    run: true,
  });
  expect(added.execution?.status).toBe("ok");
  return added.cell.id;
}

describe("dist/main.js outputs into | head", () => {
  it("exits 0 with nothing on stderr, as json into head -1 and --full into head -c 80", async () => {
    await withDaemon(async (daemon, ws) => {
      const cell = await bigValue(daemon);
      for (const [args, head] of [
        [["outputs", cell, "--format", "json"], "-n 1"],
        [["outputs", cell, "--full"], "-c 80"],
      ] as const) {
        const ran = pipeline(ws, args, head);
        const code = await ran.exited;
        expect([args, await ran.stderr(), code]).toEqual([args, "", 0]);
      }
    });
  });
});

/**
 * Changes a setting, one event each, until the pipeline ended: head takes the first line and goes, and the bin notices
 * only at a write after head has gone, which on a loaded machine may be later than the second event's (that write can
 * still land in the pipe's buffer while head exits), so two events alone could leave it following for ever.
 */
async function eventsUntil(daemon: Daemon, exited: Promise<unknown>): Promise<unknown> {
  const watched = { ended: false };
  const code = exited.finally(() => {
    watched.ended = true;
  });
  for (let n = 0; !watched.ended && n < 500; n += 1)
    await daemon.client.settings.set({ key: "editor.fontSize", value: 15 + (n % 2) });
  return code;
}

describe("dist/main.js events --follow into | head -1", () => {
  it("ends at the next event once head has gone, exit 0 with only its Following line on stderr", async () => {
    await withDaemon(async (daemon, ws) => {
      const ran = pipeline(ws, ["events", "--follow"], "-n 1");
      await expect.poll(ran.stderr, { timeout: 10_000, interval: 20 }).toMatch(/^Following /);
      const code = await eventsUntil(daemon, ran.exited);
      expect([code, (await ran.stderr()).split("\n").filter((line) => line !== "")]).toEqual([
        0,
        [expect.stringMatching(/^Following /) as unknown],
      ]);
    });
  });
});
