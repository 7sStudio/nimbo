// The daemon of another workspace folder, for workspace.open: the live one its server.json names, found
// as a start finds it (files/existingDaemon.ts), else one this daemon starts as `nimbo open` forks it:
// its own entry with `--workspace <folder>`, the same built UI and user config folder, detached, its stdout read
// until the listening line, its stderr in a file of its own (in the temp folder until it listens, then moved into the
// folder's `.jsnb/logs/stderr.log`), then let go. Its port and token are read from the server.json it wrote. A start
// that another start won (`DaemonRunning`) means a daemon is there to use.
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, open, readFile, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { z } from "zod";

import { DaemonServingMovedFolder, liveDaemon } from "../existingDaemon.js";
import type { LogLevel } from "../logs/logger.js";
import { FolderDaemonFailed } from "./errors.js";

/** How the other daemon is started: this daemon's own entry and the options it was started with. */
export type DaemonLaunch = {
  /** The daemon's process entry (`dist/main.js`); undefined when this daemon does not run from one (a test's
   * in-process daemon), which can then only use a daemon already running there. */
  readonly entry: string | undefined;
  readonly uiDir: string | undefined;
  readonly userConfigDir: string;
  readonly logLevel: LogLevel;
};

/** How long a start may stay silent before it is stopped (a hang guard; a start takes well under 2 s). */
const startTimeoutMs = 30_000;

const Failure = z.looseObject({ name: z.string(), message: z.string() });

/** The live daemon of `workspace` (its real path), or undefined; one serving the folder before it moved is a failure
 * in its own words. */
async function liveOf(workspace: string) {
  try {
    return await liveDaemon(join(workspace, ".jsnb", "server.json"), workspace);
  } catch (error) {
    if (error instanceof DaemonServingMovedFolder)
      throw new FolderDaemonFailed({ workspace, reason: error.name }, error.message);
    // `.jsnb` is not a folder there (a file, a link to nothing): no daemon; the start says what is wrong.
    return undefined;
  }
}

type Ended = { readonly listening: boolean };

/** Settles at the listening line, or when the process ends (or cannot start, or stays silent past the guard). */
function watch(child: ReturnType<typeof spawn>): Promise<Ended> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), startTimeoutMs);
    const settle = (ended: Ended): void => {
      clearTimeout(timer);
      resolve(ended);
    };
    if (child.stdout)
      createInterface({ input: child.stdout }).on("line", (line) => {
        if (line.includes('"event":"listening"')) settle({ listening: true });
      });
    child.once("close", () => {
      settle({ listening: false });
    });
    child.once("error", () => {
      settle({ listening: false });
    });
  });
}

/** The last JSON line the failed start wrote, as `{ name, message }`. */
function failureIn(
  stderr: string,
): { readonly name: string; readonly message: string } | undefined {
  const last = stderr.trim().split("\n").at(-1) ?? "";
  try {
    const parsed = Failure.safeParse(JSON.parse(last));
    return parsed.success ? parsed.data : undefined;
  } catch {
    // Not JSON (a crash's stack): no words of the daemon's own.
    return undefined;
  }
}

/** Moves the started daemon's stderr into its `.jsnb/logs`, the last one's kept as `stderr.previous.log`. */
async function keepStderr(file: string, workspace: string): Promise<boolean> {
  const logs = join(workspace, ".jsnb", "logs");
  try {
    await mkdir(logs, { recursive: true });
    await rename(join(logs, "stderr.log"), join(logs, "stderr.previous.log")).catch(
      () => undefined,
    );
    await rename(file, join(logs, "stderr.log"));
    return true;
  } catch {
    // Another disk (EXDEV) or a folder that refuses: the file stays in the temp folder, still written.
    return false;
  }
}

/** Starts the daemon of `workspace`; resolves once it listens (or another start won), else FolderDaemonFailed. */
async function start(
  workspace: string,
  launch: DaemonLaunch & { readonly entry: string },
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "nimbo-open-"));
  const file = join(dir, "stderr.log");
  const handle = await open(file, "w", 0o600);
  const args = [launch.entry, "--workspace", workspace, "--user-config", launch.userConfigDir];
  const child = spawn(
    process.execPath,
    [
      ...args,
      "--log-level",
      launch.logLevel,
      ...(launch.uiDir === undefined ? [] : ["--ui", launch.uiDir]),
    ],
    { cwd: workspace, detached: true, windowsHide: true, stdio: ["ignore", "pipe", handle.fd] },
  );
  const watching = watch(child);
  await handle.close(); // the daemon holds its own copy
  const { listening } = await watching;
  if (listening) {
    child.stdout?.destroy(); // its one line is read
    child.unref();
    if (await keepStderr(file, workspace)) await rm(dir, { recursive: true, force: true });
    return;
  }
  const said = failureIn(await readFile(file, "utf8").catch(() => ""));
  await rm(dir, { recursive: true, force: true });
  if (said?.name === "DaemonRunning") return;
  throw new FolderDaemonFailed({ workspace, reason: said?.name ?? "DaemonExited" }, said?.message);
}

/** The port and token of `workspace`'s daemon: the live one, else one started for it. */
export async function folderDaemon(
  workspace: string,
  launch: DaemonLaunch,
): Promise<{ readonly port: number; readonly token: string }> {
  const live = await liveOf(workspace);
  if (live !== undefined) return live;
  const { entry } = launch;
  if (entry === undefined)
    throw new FolderDaemonFailed(
      { workspace, reason: "NoEntry" },
      "this daemon was not started from its process entry, so it cannot start another; run nimbo open in that folder.",
    );
  await start(workspace, { ...launch, entry });
  const started = await liveOf(workspace);
  if (started === undefined)
    throw new FolderDaemonFailed({ workspace, reason: "NoServerFile" }, "it wrote no server.json.");
  return started;
}
