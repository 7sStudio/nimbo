// With real components only: the built bin (dist/main.js) starts the built daemon
// and is killed right after the spawn, so its start folder (`<workspace>/.jsnb/start-…`) outlives it while the daemon
// lives on. The daemon's own stderr writes land in that folder's file (Node's inspector line, on
// SIGUSR1); the daemon is then killed, as a crash would, and the next start keeps its words in the workspace's logs.
import type { ChildProcess } from "node:child_process";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Workspace } from "@jsnb/test-tools/workspace";
import { withWorkspace } from "@jsnb/test-tools/workspace";
import { describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../../dist/main.js", import.meta.url));

const envOf = (ws: Workspace) => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: ws.path(".user-config"),
});

/** `nimbo <argv>` from the built bin in `ws`; its exit code. */
const jsnbBin = (ws: Workspace, argv: readonly string[]): Promise<number> =>
  new Promise((resolve) => {
    execFile(process.execPath, [bin, ...argv], { cwd: ws.dir, env: envOf(ws) }, (error) => {
      resolve(typeof error?.code === "number" ? error.code : 0);
    });
  });

/** The start folders in `ws`'s `.jsnb`. */
const startFolders = async (ws: Workspace): Promise<readonly string[]> =>
  existsSync(ws.path(".jsnb"))
    ? (await readdir(ws.path(".jsnb"))).filter((name) => name.startsWith("start-"))
    : [];

/** The pid a start folder's record names once the daemon is spawned, or undefined. */
async function spawnedPid(ws: Workspace): Promise<number | undefined> {
  for (const name of await startFolders(ws)) {
    const record: unknown = JSON.parse(
      await readFile(ws.path(".jsnb", name, "start.json"), "utf8"),
    );
    const pid: unknown =
      typeof record === "object" && record !== null ? Reflect.get(record, "pid") : undefined;
    if (typeof pid === "number") return pid;
  }
  return undefined;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false; // ESRCH: the process is gone
  }
};

const poll = { timeout: 15_000, interval: 20 };

describe("a daemon whose CLI was killed during its start", () => {
  it("keeps its stderr in the workspace, and the next start keeps its words when it has died", async () => {
    await withWorkspace(async (ws) => {
      let cli: ChildProcess | undefined;
      let daemon: number | undefined;
      try {
        cli = spawn(process.execPath, [bin, "config", "set", "editor.fontSize", "15"], {
          cwd: ws.dir,
          env: envOf(ws),
          stdio: "ignore",
        });
        await expect.poll(async () => (daemon = await spawnedPid(ws)), poll).toBeDefined();
        const exited = once(cli, "exit");
        cli.kill("SIGKILL");
        await exited;
        await expect.poll(() => existsSync(ws.path(".jsnb/server.json")), poll).toBe(true);
        const [folder] = await startFolders(ws);
        const words = ws.path(".jsnb", folder ?? "", "stderr.log");
        process.kill(daemon ?? 0, "SIGUSR1"); // Node writes its inspector line on the daemon's own stderr
        await expect.poll(async () => readFile(words, "utf8"), poll).toMatch(/inspector|Debugger/);
        const said = await readFile(words, "utf8");
        process.kill(daemon ?? 0, "SIGKILL"); // the crash: no clean stop, no word but those already written
        await expect.poll(() => alive(daemon ?? 0), poll).toBe(false);
        expect(await jsnbBin(ws, ["config", "set", "editor.fontSize", "16"])).toBe(0);
        expect(await readFile(ws.path(".jsnb/logs/stderr.previous.log"), "utf8")).toBe(said);
        expect(await startFolders(ws)).toEqual([]);
        expect(await jsnbBin(ws, ["stop"])).toBe(0);
        await expect.poll(() => existsSync(ws.path(".jsnb/server.json")), poll).toBe(false);
      } finally {
        cli?.kill("SIGKILL");
        if (daemon !== undefined && alive(daemon)) process.kill(daemon, "SIGKILL");
      }
    });
  });
});
