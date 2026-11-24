// The daemon's js-debug: one DAP server process (vendor/js-debug, fetched by tools/fetch-js-debug.mjs) started on the
// first debugger use, shared by every notebook's debug session, started again after it died. It listens on a Unix
// socket in a directory only this user can enter (a named pipe on Windows), never on a TCP port: a DAP client can make
// js-debug launch any program. A small wrapper ends it when the daemon's pipe to it closes or its parent changes, so it
// never outlives the daemon, even one killed with SIGKILL; a daemon's start removes the directories nothing answers in.
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { NotAvailable } from "@jsnb/core";

import type { Log } from "../../events/log.js";
import type { DapConnection } from "./dap.js";
import { connectDap } from "./dap.js";

/** Where the build puts js-debug: `packages/server/vendor/js-debug`, from the sources and the built package alike. */
const defaultJsDebugDir = fileURLToPath(new URL("../../../vendor/js-debug/", import.meta.url));

const startTimeoutMs = 15_000;
const prefix = "nimbo-debug-";
/** The directories made under /tmp when TMPDIR is too long for a socket's path. */
const shortPrefix = "nimbo-dbg-";
const shortParent = "/tmp";
const socketName = "dap.sock";
/** Under the 104 bytes macOS allows a socket's path (108 on Linux). */
const maxSocketPath = 100;

export type Adapter = {
  /** A new DAP connection (one per debug session); NotAvailable when js-debug is missing or does not start. */
  readonly connect: () => Promise<DapConnection>;
  readonly stop: () => void;
};

const unavailable = (reason: string): NotAvailable =>
  new NotAvailable({ feature: "The debugger", reason });

const missing = (dir: string): NotAvailable =>
  unavailable(
    `js-debug is missing from ${dir}. From a nimbo checkout, run \`node tools/fetch-js-debug.mjs\` (the server's build runs it); an installed nimbo ships it, so install nimbo again.`,
  );

/** Runs js-debug's server in this process and exits once the daemon's pipe closes or the parent changes. */
const wrapper = [
  "process.stdin.on('end', () => process.exit(0));",
  "process.stdin.on('error', () => process.exit(0));",
  "process.stdin.resume();",
  "const parent = process.ppid;",
  "setInterval(() => { if (process.ppid !== parent) process.exit(0); }, 1000).unref();",
  "require(process.argv[1]);",
].join(" ");

type Running = {
  readonly child: ChildProcess;
  readonly address: Promise<string>;
  readonly dir: string | undefined;
};

const codeOf = (error: unknown): unknown =>
  typeof error === "object" && error !== null && "code" in error ? error.code : undefined;

/** Makes `dir` as a new directory only this user can enter: one that exists already, a symlink included, fails with
 * EEXIST, and one that does not turn out a real 0700 directory of this user is refused. */
export function makePrivateDir(dir: string): void {
  mkdirSync(dir, { mode: 0o700 });
  chmodSync(dir, 0o700);
  const made = lstatSync(dir);
  if (!made.isDirectory() || made.uid !== process.getuid?.() || (made.mode & 0o777) !== 0o700)
    throw unavailable(`${dir} is not a private directory of this user.`);
}

/** A new 0700 directory for the socket: under TMPDIR when the socket's path fits, else a short one under /tmp. */
export function socketDir(): string {
  if (Buffer.byteLength(join(tmpdir(), `${prefix}XXXXXX`, socketName)) < maxSocketPath)
    return mkdtempSync(join(tmpdir(), prefix));
  for (let attempt = 0; ; attempt += 1) {
    const dir = join(shortParent, `${shortPrefix}${randomBytes(4).toString("hex")}`);
    try {
      makePrivateDir(dir);
      return dir;
    } catch (error) {
      if (codeOf(error) !== "EEXIST" || attempt >= 20) throw error;
    }
  }
}

/** Where js-debug listens: a socket in a new 0700 directory, or a named pipe on Windows. */
function placeOf(): { readonly address: string; readonly dir: string | undefined } {
  if (process.platform === "win32")
    return { address: `\\\\.\\pipe\\${prefix}${randomUUID()}`, dir: undefined };
  const dir = socketDir();
  return { address: join(dir, socketName), dir };
}

/** Whether something answers on the socket at `path`. */
const answers = (path: string): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ path });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });

/** This user's real directories in `parent` whose names start with `start`. */
function ownIn(parent: string, start: string): string[] {
  let names: string[];
  try {
    names = readdirSync(parent).filter((each) => each.startsWith(start));
  } catch {
    return [];
  }
  return names
    .map((name) => join(parent, name))
    .filter((dir) => {
      try {
        const found = lstatSync(dir);
        return found.isDirectory() && found.uid === process.getuid?.();
      } catch {
        return false;
      }
    });
}

/** This user's js-debug directories, under TMPDIR and under /tmp. */
const ownDirs = (): string[] => [...ownIn(tmpdir(), prefix), ...ownIn(shortParent, shortPrefix)];

/** Removes the directories of js-debugs that no longer answer (their daemon died, and the wrapper with it). Nothing is
 * killed: a recorded pid may by now be another program's. */
export async function removeStale(log: Log): Promise<void> {
  for (const dir of ownDirs()) {
    try {
      // a younger directory may be another daemon's whose js-debug is still starting
      if (Date.now() - lstatSync(dir).mtimeMs < startTimeoutMs) continue;
      if (await answers(join(dir, socketName))) continue;
      rmSync(dir, { recursive: true, force: true });
    } catch (error) {
      log.debug({ err: error, dir }, "a js-debug directory was left as it is");
    }
  }
}

/** The address the DAP server prints once it listens, or its failure. */
function addressOf(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(unavailable(`js-debug did not start within ${String(startTimeoutMs / 1000)} s.`));
    }, startTimeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      out += chunk.toString("utf8");
      const listening = /listening at (.+)\r?\n/u.exec(out);
      if (listening?.[1] !== undefined) {
        clearTimeout(timer);
        resolve(listening[1].trim());
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      err = `${err}${chunk.toString("utf8")}`.slice(-2000);
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(unavailable(`js-debug could not start: ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      const how = signal ?? `code ${String(code)}`;
      reject(unavailable(`js-debug exited (${how}) as it started. ${err.trim()}`.trim()));
    });
  });
}

/** js-debug started from `dir` through the wrapper; `exited` hears its end. */
function startIn(dir: string, log: Log, exited: (own: Running) => void): Running {
  const entry = join(dir, "src", "dapDebugServer.js");
  if (!existsSync(entry)) throw missing(dir);
  const place = placeOf();
  const child = spawn(process.execPath, ["-e", wrapper, entry, place.address], {
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NODE_OPTIONS: "" },
  });
  const own: Running = { child, address: addressOf(child), dir: place.dir };
  own.address.catch(() => undefined);
  child.once("exit", () => {
    if (own.dir !== undefined) rmSync(own.dir, { recursive: true, force: true });
    exited(own);
  });
  log.info({ pid: child.pid, address: place.address }, "js-debug started");
  return own;
}

/** The adapter over the js-debug in `dir`, started on first use with the daemon's own Node. */
export function createAdapter(options: { readonly dir?: string; readonly log: Log }): Adapter {
  const dir = options.dir ?? defaultJsDebugDir;
  let running: Running | undefined;
  let stopped = false;
  if (process.platform !== "win32") void removeStale(options.log);
  const exited = (own: Running): void => {
    if (running === own) running = undefined;
    if (!stopped) options.log.warn({ code: own.child.exitCode }, "js-debug exited");
  };
  return {
    connect: async () => {
      if (stopped) throw unavailable("the daemon is stopping.");
      running ??= startIn(dir, options.log, exited);
      const own = running;
      try {
        return await connectDap(await own.address);
      } catch (error) {
        if (running === own) running = undefined;
        if (error instanceof NotAvailable) throw error;
        throw unavailable(`js-debug does not answer: ${String(error)}`);
      }
    },
    stop: () => {
      stopped = true;
      running?.child.kill("SIGKILL");
      running = undefined;
    },
  };
}
