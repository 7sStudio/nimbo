// The built bin, dist/main.js, run as a shell runs it (after `pnpm build`; cli:integration): its help,
// one call against a running daemon, exit 3 with none, and a mutating command forking the server's built entry
// (@jsnb/server/main, no NIMBO_DAEMON_ENTRY) and `nimbo stop` stopping it. This is what proves src/main.ts's wiring.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { withDaemon } from "@jsnb/test-daemon";
import type { Workspace } from "@jsnb/test-tools/workspace";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

import { rootHelp } from "./help.js";

const bin = fileURLToPath(new URL("../dist/main.js", import.meta.url));

type Exit = { readonly code: number; readonly out: string; readonly err: string };

/** `node dist/main.js <argv>` in the workspace, with an environment of its own (no NIMBO_* of the test's). */
const jsnbBin = (ws: Workspace, argv: readonly string[]): Promise<Exit> =>
  new Promise((resolve) => {
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      XDG_CONFIG_HOME: ws.path(".user-config"),
    };
    execFile(process.execPath, [bin, ...argv], { cwd: ws.dir, env }, (error, out, err) => {
      resolve({ code: typeof error?.code === "number" ? error.code : 0, out, err });
    });
  });

describe("dist/main.js", () => {
  it("prints the root help and exits 0", async () => {
    await withWorkspace(async (ws) => {
      const help = await jsnbBin(ws, ["--help"]);
      expect([help.code, help.out]).toEqual([0, rootHelp()]);
    });
  });
});

describe("dist/main.js", () => {
  it("calls a running daemon, and exits 3 with none", async () => {
    await withDaemon(async (daemon, ws) => {
      const info = await jsnbBin(ws, ["workspace", "info", "--json"]);
      expect(info.code).toBe(0);
      expect(JSON.parse(info.out)).toEqual(await daemon.http().workspace.info({}));
    });
    await withWorkspace(async (ws) => {
      expect(await jsnbBin(ws, ["ls"])).toMatchObject({ code: 3, out: "" });
    });
  });

  it("opens a notebook the daemon has on disk but closed, and calls again (an agent need not track it)", async () => {
    await withDaemon(async (daemon, ws) => {
      await daemon.http().notebook.create({ path: "a.jsnb" });
      await daemon
        .http()
        .cell.add({ notebook: "a.jsnb", type: "server", source: "40 + 2", run: true });
      await daemon.http().notebook.close({ notebook: "a.jsnb" });
      const ls = await jsnbBin(ws, ["ls", "-n", "a.jsnb"]);
      expect([ls.code, ls.err]).toEqual([0, ""]);
      expect(ls.out).toContain("40 + 2");
      // close is never retried: closing a closed notebook stays NotebookNotFound, nothing opened to close it again
      const close = await jsnbBin(ws, ["notebook", "close", "-n", "a.jsnb"]);
      expect(close.code).toBe(0);
      expect((await jsnbBin(ws, ["notebook", "close", "-n", "a.jsnb"])).code).toBe(4);
    });
  });
});

describe("dist/main.js", () => {
  it("starts the server's built entry for a mutating command, and nimbo stop stops it", async () => {
    await withWorkspace(async (ws) => {
      const set = await jsnbBin(ws, ["config", "set", "editor.fontSize", "15"]);
      expect([set.code, set.out, set.err]).toEqual([0, "editor.fontSize = 15 (workspace)\n", ""]);
      expect((await jsnbBin(ws, ["config", "get", "editor.fontSize"])).out).toBe(
        "editor.fontSize  15  workspace\n",
      );
      // A process's working folder is its real path (/private/var/… on macOS).
      const real = await realpath(ws.dir);
      expect(await jsnbBin(ws, ["stop"])).toMatchObject({
        code: 0,
        out: `Stopped the daemon for ${real}.\n`,
      });
      await expect
        .poll(() => existsSync(ws.path(".jsnb/server.json")), { timeout: 10_000, interval: 20 })
        .toBe(false);
    });
  });
});

describe("nimbo stop of a daemon that does not answer", () => {
  it("is DaemonUnresponsive, exit 3, and --force ends its process", async () => {
    await withWorkspace(async (ws) => {
      expect((await jsnbBin(ws, ["config", "set", "editor.fontSize", "15"])).code).toBe(0);
      const { pid } = JSON.parse(await readFile(ws.path(".jsnb/server.json"), "utf8")) as {
        pid: number;
      };
      process.kill(pid, "SIGSTOP");
      try {
        const refused = await jsnbBin(ws, ["stop"]);
        expect([refused.code, refused.err]).toEqual([
          3,
          expect.stringContaining("DaemonUnresponsive"),
        ]);
        expect((await jsnbBin(ws, ["stop", "--force"])).code).toBe(0);
        expect(() => process.kill(pid, 0)).toThrow();
      } finally {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // ended by the test
        }
      }
    });
  });
});

describe("dist/main.js in a working folder that was deleted", () => {
  it("is WorkingFolderGone, exit 2, with no stack; the help still prints", async () => {
    await withWorkspace(async (ws) => {
      const gone = (argv: string): Promise<Exit> =>
        new Promise((resolve) => {
          // The shell enters the folder, removes it, then runs the bin there: a folder gone from under the user.
          const script = `mkdir gone && cd gone && rmdir "$PWD" && exec "$0" "$1" ${argv}`;
          execFile(
            "/bin/sh",
            ["-c", script, process.execPath, bin],
            { cwd: ws.dir },
            (error, out, err) => {
              resolve({ code: typeof error?.code === "number" ? error.code : 0, out, err });
            },
          );
        });
      expect(await gone("status")).toEqual({
        code: 2,
        out: "",
        err: "WorkingFolderGone: The working folder no longer exists (deleted or moved from another terminal?). cd to a folder, then run the command again.\n",
      });
      expect((await gone("--help")).code).toBe(0);
    });
  });
});
