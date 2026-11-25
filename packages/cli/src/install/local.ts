// The installer's files on this machine (02-architecture §10): the versions folder, the launcher link, the processes
// running from each version and the workspaces whose daemon is one of them. Unpacking and the link switch are each one
// rename, so an interrupted upgrade leaves the old version and the old link in place.
import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

import { parseServerFile, productConfigDir } from "@jsnb/core";
import { z } from "zod";

import { InstallFailed } from "./errors.js";
import { withLegacyConfigMoved } from "./legacyConfigDir.js";
import { isReleaseVersion, staleVersions, versionsInUse } from "./versions.js";

const run = promisify(execFile);

export const versionsDirOf = (dataDir: string): string => join(dataDir, "versions");

/** The version folders installed, hidden work folders left out. */
export async function installedVersions(dataDir: string): Promise<string[]> {
  try {
    const entries = await readdir(versionsDirOf(dataDir), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch {
    // No versions folder: nothing installed.
    return [];
  }
}

/** The data folder as written and as resolved, so a path through a symlinked HOME matches either. */
function spellings(dir: string): string[] {
  try {
    const physical = realpathSync(dir);
    return physical === dir ? [dir] : [dir, physical];
  } catch {
    return [dir];
  }
}

type ProcessLine = { pid: number; command: string };

/** Each process's executable from /proc, for a Linux without `ps` (procps not installed). */
async function procExecutables(): Promise<ProcessLine[]> {
  const found: ProcessLine[] = [];
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/u.test(name)) continue;
    try {
      found.push({ pid: Number(name), command: await readlink(`/proc/${name}/exe`) });
    } catch {
      // another user's process, or one that ended meanwhile
    }
  }
  return found;
}

/** Every process's pid and command line, from `ps` (or /proc); undefined when neither can be read. */
export async function processCommands(): Promise<ProcessLine[] | undefined> {
  try {
    const { stdout } = await run("ps", ["-axww", "-o", "pid=,args="], {
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout
      .split("\n")
      .map((line) => /^\s*(\d+)\s+(.*)$/u.exec(line))
      .filter((match) => match !== null)
      .map((match) => ({ pid: Number(match[1]), command: match[2] ?? "" }));
  } catch {
    // no ps: /proc on Linux, else nothing to go by
  }
  try {
    return await procExecutables();
  } catch {
    return undefined;
  }
}

/**
 * The pids running from each installed version, this process left out; undefined when the processes cannot be listed,
 * in which case every version counts as in use.
 */
export async function versionsRunning(dataDir: string): Promise<Map<string, number[]> | undefined> {
  const commands = await processCommands();
  if (commands === undefined) return undefined;
  const dirs = spellings(versionsDirOf(dataDir));
  const found = versionsInUse(dirs, commands, process.pid);
  // A Node started through another spelling of the path (an alias link to the data folder): its real executable.
  const matched = new Set([...found.values()].flat());
  const others = commands.filter(
    ({ pid, command }) => !matched.has(pid) && /(?:^|\/)node(?:\s|$)/u.test(command),
  );
  for (const [version, pids] of versionsInUse(dirs, await executables(others), process.pid))
    found.set(version, [...(found.get(version) ?? []), ...pids]);
  return found;
}

/** The executables of these processes, links resolved: /proc on Linux, lsof on macOS, none elsewhere. */
async function executables(processes: readonly ProcessLine[]): Promise<ProcessLine[]> {
  if (processes.length === 0) return [];
  if (existsSync("/proc/self/exe")) return procExes(processes);
  return process.platform === "darwin" ? lsofExes(processes) : [];
}

async function procExes(processes: readonly ProcessLine[]): Promise<ProcessLine[]> {
  const found: ProcessLine[] = [];
  for (const { pid } of processes) {
    const exe = await readlink(`/proc/${String(pid)}/exe`).catch(() => undefined);
    if (exe !== undefined) found.push({ pid, command: exe });
  }
  return found;
}

async function lsofExes(processes: readonly ProcessLine[]): Promise<ProcessLine[]> {
  const pids = processes.map(({ pid }) => String(pid)).join(",");
  const lsof = existsSync("/usr/sbin/lsof") ? "/usr/sbin/lsof" : "lsof";
  const stdout = await run(lsof, ["-nP", "-a", "-p", pids, "-d", "txt", "-Fpn"], {
    maxBuffer: 16 * 1024 * 1024,
  }).then(
    (result) => result.stdout,
    // lsof exits 1 when one of the processes ended meanwhile, with what it found on stdout
    (error: unknown) => String(Reflect.get(Object(error), "stdout") ?? ""),
  );
  const found: ProcessLine[] = [];
  let pid = 0;
  for (const line of stdout.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid > 0) found.push({ pid, command: line.slice(1) });
  }
  return found;
}

/** Throws unless `path` is a direct child of the versions folder (it is about to be removed or replaced). */
export function assertVersionPath(dataDir: string, path: string): void {
  const versionsDir = resolve(versionsDirOf(dataDir));
  const target = resolve(path);
  const name = relative(versionsDir, target);
  if (name === "" || name.includes(sep) || name.startsWith("..") || !isReleaseVersion(name)) {
    throw new InstallFailed({
      what: `Refused to change ${path}: it is not a version folder of ${versionsDir}.`,
      todo: "The release looks wrong; report it.",
    });
  }
}

const wrongRelease = (what: string): InstallFailed =>
  new InstallFailed({ what, todo: "The release looks wrong; report it." });

/** Extracts `file` into `work`; a failure is the disk's, as the tarball was verified. */
async function extract(file: string, work: string): Promise<void> {
  try {
    await run("tar", ["-xzf", file, "-C", work]);
  } catch (error) {
    throw new InstallFailed(
      {
        what: "The download could not be unpacked.",
        todo: "Check the free disk space, then try again.",
      },
      { cause: error },
    );
  }
}

/**
 * Unpacks a verified tarball as `versions/<version>`: into a hidden folder beside it, then one rename, then a check that
 * the version's command is there. The tarball's top folder must be `<product>-<version>-<target>`.
 */
export async function unpackVersion(
  dataDir: string,
  tarball: Uint8Array,
  topFolder: string,
  version: string,
): Promise<string> {
  const versionsDir = versionsDirOf(dataDir);
  const target = join(versionsDir, version);
  assertVersionPath(dataDir, target);
  if (!/^[A-Za-z0-9]+-\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?-[a-z]+-[a-z0-9]+$/u.test(topFolder)) {
    throw wrongRelease(`The release names an unexpected folder: ${topFolder}.`);
  }
  await mkdir(versionsDir, { recursive: true });
  const work = await mkdtemp(join(versionsDir, `.unpack-${version}-`));
  try {
    const file = join(work, "release.tar.gz");
    await writeFile(file, tarball);
    await extract(file, work);
    if (!existsSync(join(work, topFolder, "bin")))
      throw wrongRelease(`The download does not hold ${topFolder}/bin.`);
    await rm(target, { recursive: true, force: true });
    await rename(join(work, topFolder), target);
    if (!existsSync(join(target, "bin"))) {
      throw new InstallFailed({
        what: `${target} is incomplete after unpacking.`,
        todo: "Try again once other installs have finished.",
      });
    }
    return target;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** The folders an interrupted unpack or DuckDB install left behind. */
export async function leftovers(dataDir: string): Promise<string[]> {
  const matching = async (dir: string, pattern: RegExp): Promise<string[]> =>
    (await readdir(dir).catch(() => []))
      .filter((name) => pattern.test(name))
      .map((name) => join(dir, name));
  return [
    ...(await matching(versionsDirOf(dataDir), /^\.unpack-/u)),
    ...(await matching(join(dataDir, "duckdb"), /\.partial-/u)),
  ];
}

/** Removes what `leftovers` finds; called holding the lock, so no live process is unpacking into them. */
export async function sweepLeftovers(dataDir: string): Promise<string[]> {
  const found = await leftovers(dataDir);
  for (const path of found) await rm(path, { recursive: true, force: true });
  return found;
}

/** Points the launcher link `bin` at `target`: a new link beside it, renamed over the old one. */
export async function pointLauncher(bin: string, target: string): Promise<void> {
  await mkdir(dirname(bin), { recursive: true });
  const fresh = `${bin}.new-${String(process.pid)}`;
  await rm(fresh, { force: true });
  await symlink(target, fresh);
  await rename(fresh, bin);
}

/** Where the launcher link points, or undefined when `bin` is not a link. */
export async function launcherTarget(bin: string): Promise<string | undefined> {
  try {
    return (await lstat(bin)).isSymbolicLink() ? await readlink(bin) : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the launcher link points into this data folder's versions, comparing resolved paths. */
export async function launcherOwned(bin: string, dataDir: string): Promise<boolean> {
  const target = await launcherTarget(bin);
  if (target === undefined) return false;
  const absolute = resolve(dirname(bin), target);
  const prefixes = spellings(versionsDirOf(dataDir)).map((dir) => `${dir}/`);
  const candidates = spellings(dirname(absolute)).map((dir) => join(dir, basename(absolute)));
  return candidates.some((path) => prefixes.some((prefix) => path.startsWith(prefix)));
}

export type Sweep = {
  readonly removed: readonly string[];
  readonly kept: ReadonlyMap<string, readonly number[]>;
};

/** Removes every installed version but `current` that no process runs from. */
export async function sweepVersions(dataDir: string, current: string): Promise<Sweep> {
  const running = await versionsRunning(dataDir);
  const installed = (await installedVersions(dataDir)).filter(isReleaseVersion);
  const { remove, kept } = staleVersions(
    installed,
    current,
    running === undefined ? new Set(installed) : new Set(running.keys()),
  );
  for (const version of remove) {
    const path = join(versionsDirOf(dataDir), version);
    assertVersionPath(dataDir, path);
    await rm(path, { recursive: true, force: true });
  }
  return {
    removed: remove,
    kept: new Map(kept.map((version) => [version, running?.get(version) ?? []])),
  };
}

const Recent = z.object({ folders: z.array(z.object({ path: z.string() })) });

/** The user config folder (07-file-format §6), as the daemon places it. */
export function userConfigDir(env: Readonly<Record<string, string | undefined>>): string {
  return withLegacyConfigMoved(productConfigDir(env, env.HOME ?? homedir(), process.platform));
}

export type RecentDaemon = {
  readonly root: string;
  readonly pid: number;
  readonly version: string;
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && Reflect.get(error, "code") === "EPERM";
  }
};

/** The daemons the recent workspaces' server.json name that still run (Home's list, 03-api §4.1). */
export async function recentDaemons(
  env: Readonly<Record<string, string | undefined>>,
): Promise<RecentDaemon[]> {
  let folders: string[] = [];
  try {
    const parsed = Recent.safeParse(
      JSON.parse(await readFile(join(userConfigDir(env), "recent.json"), "utf8")),
    );
    folders = parsed.success ? parsed.data.folders.map((folder) => folder.path) : [];
  } catch {
    // No recent.json: no workspace opened yet.
  }
  const found: RecentDaemon[] = [];
  for (const folder of folders) {
    let text: string;
    try {
      text = await readFile(join(folder, ".jsnb", "server.json"), "utf8");
    } catch {
      continue; // no daemon there
    }
    const file = parseServerFile(text);
    if (file !== undefined && alive(file.pid))
      found.push({ root: file.root, pid: file.pid, version: file.version });
  }
  return found;
}

/** The bytes a file or folder takes, links not followed; 0 when it is not there. */
export async function sizeOf(path: string): Promise<number> {
  let info;
  try {
    info = await lstat(path);
  } catch {
    return 0;
  }
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const name of await readdir(path).catch(() => [])) total += await sizeOf(join(path, name));
  return total;
}
