// The data folder's lock, shared with the installer script and the CLI's upgrade and uninstall,
// the same protocol as the CLI's install/lock.ts: the folder `<data>/.lock` holding `pid`, `started` and `command`, made
// with one atomic mkdir; a stale lock (its process gone, or its pid reused) is taken over under `.lock.takeover`.
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { JsnbError, productName } from "@jsnb/core";

/** Another install, upgrade, uninstall or DuckDB install holds the data folder's lock. */
class InstallBusy extends JsnbError {
  declare readonly data: {
    readonly pid: number;
    readonly command: string;
    readonly lock: string;
    readonly what: string;
    readonly todo: string;
    readonly details: readonly string[];
  };
  constructor(data: { readonly pid: number; readonly command?: string; readonly lock: string }) {
    const command = data.command ?? "";
    const what = `Another ${productName} install or upgrade is running (process ${String(data.pid)}${command === "" ? "" : `: ${command}`}).`;
    const todo = `Wait for it to finish, then try again. If none is running, remove the lock: rm -r '${data.lock.replaceAll("'", "'\\''")}'`;
    super({
      name: "InstallBusy",
      message: `${what} ${todo}`,
      data: { pid: data.pid, command, lock: data.lock, what, todo, details: [] },
    });
  }
}

const run = promisify(execFile);

const lockDirOf = (dataDir: string): string => join(dataDir, ".lock");

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && Reflect.get(error, "code") === "EPERM";
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** A process's start time, the same text the installer script records; "" when it cannot be read. */
async function startedOf(pid: number): Promise<string> {
  try {
    const { stdout } = await run("ps", ["-o", "lstart=", "-p", String(pid)], {
      env: { ...process.env, LC_ALL: "C" },
    });
    return stdout.trim();
  } catch {
    // no ps (a minimal Linux): the start time in clock ticks from /proc
  }
  try {
    const text = await readFile(`/proc/${String(pid)}/stat`, "utf8");
    const ticks = text.slice(text.lastIndexOf(")") + 2).split(" ")[19];
    return ticks === undefined ? "" : `stat:${ticks}`;
  } catch {
    return "";
  }
}

type LockOwner = { readonly pid: number; readonly started: string; readonly command: string };

const readText = (path: string): Promise<string> =>
  readFile(path, "utf8").then(
    (text) => text.trim(),
    () => "",
  );

/** What a lock folder records; pid 0 while its taker has made the folder but not yet written the files. */
async function ownerOf(lock: string): Promise<LockOwner> {
  const pid = Number.parseInt(await readText(join(lock, "pid")), 10);
  return {
    pid: Number.isInteger(pid) && pid > 0 ? pid : 0,
    started: await readText(join(lock, "started")),
    command: await readText(join(lock, "command")),
  };
}

/** Whether the process a lock names still runs: alive, and the same process when its start time was recorded. */
async function live(owner: LockOwner): Promise<boolean> {
  if (owner.pid === 0 || !alive(owner.pid)) return false;
  if (owner.started === "") return true;
  const now = await startedOf(owner.pid);
  return now === "" || now === owner.started;
}

const codeOf = (error: unknown): string =>
  error instanceof Error ? String(Reflect.get(error, "code") ?? "") : "";

/** Removes the lock if it is still stale, holding the takeover folder; false when another taker holds that. */
async function takeOver(dataDir: string): Promise<boolean> {
  const lock = lockDirOf(dataDir);
  const guard = `${lock}.takeover`;
  try {
    await mkdir(guard);
  } catch (error) {
    if (codeOf(error) !== "EEXIST") throw error;
    // A taker that died inside the takeover leaves the guard: it holds it for a moment at most.
    const age = await stat(guard).then(
      (info) => Date.now() - info.mtimeMs,
      () => 0,
    );
    if (age > 10_000) await rm(guard, { recursive: true, force: true });
    return false;
  }
  try {
    const owner = await ownerOf(lock);
    if (owner.pid === process.pid || (await live(owner))) return true;
    const aside = `${lock}.stale-${String(process.pid)}-${String(Date.now())}`;
    await rename(lock, aside).catch((error: unknown) => {
      if (codeOf(error) !== "ENOENT") throw error;
    });
    await rm(aside, { recursive: true, force: true });
    return true;
  } finally {
    await rm(guard, { recursive: true, force: true });
  }
}

const withDefaults = (options: LockOptions): Required<LockOptions> => ({
  waitMs: options.waitMs ?? 5000,
  command: options.command ?? `${productName} DuckDB install`,
});

/** Makes the lock folder and writes who holds it; false when it is there already. */
async function made(lock: string, command: string): Promise<boolean> {
  try {
    await mkdir(lock);
  } catch (error) {
    if (codeOf(error) === "EEXIST") return false;
    throw error;
  }
  await writeFile(join(lock, "pid"), `${String(process.pid)}\n`);
  await writeFile(join(lock, "started"), `${await startedOf(process.pid)}\n`);
  await writeFile(join(lock, "command"), `${command}\n`);
  return true;
}

type Lock = { readonly release: () => Promise<void> };

type LockOptions = {
  /** How long a lock held by a live process is waited for before InstallBusy. */
  readonly waitMs?: number;
  readonly command?: string;
};

/** Takes the lock, waiting up to `waitMs` for a live holder; then throws InstallBusy naming it and the lock's path. */
async function takeLock(dataDir: string, options: LockOptions = {}): Promise<Lock> {
  const lock = lockDirOf(dataDir);
  const { waitMs, command } = withDefaults(options);
  await mkdir(dataDir, { recursive: true });
  const started = Date.now();
  let unwritten = 0;
  for (;;) {
    if (await made(lock, command))
      return { release: () => rm(lock, { recursive: true, force: true }) };
    const owner = await ownerOf(lock);
    // A folder with no pid yet is a taker between its steps: it gets two seconds before it counts as stale.
    if (owner.pid === 0 && unwritten < 8) {
      unwritten += 1;
      await sleep(250);
      continue;
    }
    if (await live(owner)) {
      if (Date.now() - started >= waitMs) throw new InstallBusy({ ...owner, lock });
      await sleep(250);
      continue;
    }
    if (!(await takeOver(dataDir))) await sleep(100);
    unwritten = 0;
  }
}

/** Runs `work` holding `<dataDir>/.lock`, or throws InstallBusy. */
export async function withDataLock<T>(
  dataDir: string,
  work: () => Promise<T>,
  options: LockOptions = {},
): Promise<T> {
  const lock = await takeLock(dataDir, options);
  try {
    return await work();
  } finally {
    await lock.release();
  }
}
