// `uninstall` (03-api §8, 02-architecture §10): removes what the installer put on this machine, after a yes. It lists
// what goes and what stays, names every process running from an installed version (daemons, their kernels, agents'
// MCP servers) and stops them with SIGTERM so notebooks are saved; then the versions, the DuckDB binding, the
// launcher link, the PATH line and the MCP registrations it made go. The user config stays unless --purge; no
// workspace's .jsnb/ is ever touched, and nothing else under the data folder is.
import { readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { productName } from "@jsnb/core";

import { Declined, Interrupted } from "../errors/cli.js";
import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import type { Registration } from "../install/agents.js";
import { readRegistrations } from "../install/agents.js";
import { explained } from "../install/errors.js";
import type { InstallRecord, Installation } from "../install/installation.js";
import { findInstallation } from "../install/installation.js";
import type { PlanItem, UninstallFacts } from "../install/uninstallPlan.js";
import {
  agentLabels,
  candidateProfiles,
  profileMarker,
  uninstallPlan,
  withoutProfileLine,
} from "../install/uninstallPlan.js";
import {
  installedVersions,
  launcherOwned,
  processCommands,
  recentDaemons,
  sizeOf,
  sweepLeftovers,
  userConfigDir,
  versionsDirOf,
  versionsRunning,
} from "../install/local.js";
import { withLock } from "../install/lock.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import type { Screen } from "../io/screen.js";
import { megabytes, shellWord, withScreen } from "../io/screen.js";
import { unregister } from "./mcpInstall.js";
import type { Shortcut } from "./shortcut.js";
import { readShortcut } from "./shortcut.js";
import { howOf, UpgradeElsewhere } from "./upgrade.js";

const help = `${productName} uninstall: remove ${productName} from this machine

Lists what it removes and what it keeps, names the daemons and agent servers running from ${productName} and
stops them (notebooks are saved), then removes the installed versions, the DuckDB binding, the command's link,
the PATH line the installer added to your shell profile and the MCP registrations ${productName} made. Your
settings stay unless --purge. Workspaces and their .jsnb/ folders are never touched.

Options:
  --purge           also remove the user settings, keybindings and recent folders
  --keep-mcp        keep the MCP registrations with your agents
  -y, --yes         do not ask
`;

type Installed = {
  readonly dataDir: string;
  readonly record: InstallRecord;
  readonly releases: string;
};

/** The installer's install, or UpgradeElsewhere naming how to remove another kind. */
function installedOf(installation: Installation): Installed {
  const { dataDir, record } = installation;
  if (installation.method === "installer" && dataDir !== undefined && record !== undefined) {
    return { dataDir, record, releases: installation.release?.releases ?? "" };
  }
  const folder = installation.versionDir ?? installation.appDir;
  const command =
    installation.method === "homebrew"
      ? `brew uninstall ${productName}`
      : installation.method === "tarball"
        ? `rm -rf ${folder}, and any link to ${join(folder, "bin", productName)} you made`
        : "";
  throw new UpgradeElsewhere({
    method: installation.method,
    how: howOf(installation.method),
    command,
  });
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** SIGTERM to each, up to 15 s for them to stop, then SIGKILL to what is left. */
async function stopAll(pids: readonly number[]): Promise<void> {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // gone already
    }
  }
  for (let waited = 0; waited < 15_000 && pids.some(isAlive); waited += 200) await sleep(200);
  for (const pid of pids.filter(isAlive)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // gone meanwhile
    }
  }
}

/** The profiles holding the installer's line: those it recorded and any candidate that has the marker. */
async function markedProfiles(io: Io, record: InstallRecord): Promise<string[]> {
  const found: string[] = [];
  for (const file of [...new Set([...record.profiles, ...candidateProfiles(io.env)])]) {
    const text = await readFile(file, "utf8").catch(() => "");
    if (text.split("\n").includes(profileMarker)) found.push(file);
  }
  return found;
}

/** The PATH line out of each profile; a profile the installer created and that is now empty goes. */
async function cleanProfiles(
  profiles: readonly string[],
  created: readonly string[],
): Promise<void> {
  for (const profile of profiles) {
    try {
      const text = await readFile(profile, "utf8");
      const cleaned = withoutProfileLine(text);
      if (created.includes(profile) && cleaned.trim() === "") await rm(profile, { force: true });
      else if (cleaned !== text) await writeFile(profile, cleaned);
    } catch {
      // a profile removed since: nothing to clean
    }
  }
}

type Running = { readonly pid: number; readonly what: string };

/** The processes running from the installed versions, each named; undefined when they cannot be listed. */
async function running(io: Io, dataDir: string): Promise<Running[] | undefined> {
  const byVersion = await versionsRunning(dataDir);
  if (byVersion === undefined) return undefined;
  const pids = [...byVersion.values()].flat();
  const daemons = await recentDaemons(io.env);
  const commands = (await processCommands()) ?? [];
  return pids.map((pid) => {
    const daemon = daemons.find((found) => found.pid === pid);
    if (daemon !== undefined) return { pid, what: `the daemon of ${daemon.root}` };
    const command = commands.find((found) => found.pid === pid)?.command ?? "";
    const kind = / mcp(?:\s|$)/u.test(command)
      ? "an agent's MCP server"
      : command.includes("kernel")
        ? "a notebook kernel"
        : productName;
    return { pid, what: kind };
  });
}

async function showPlan(screen: Screen, plan: ReturnType<typeof uninstallPlan>): Promise<void> {
  const width = Math.max(
    ...[...plan.remove, ...plan.keep]
      .filter((item) => item.path !== undefined)
      .map((item) => item.label.length),
  );
  const line = async (tone: "info" | "ok", item: PlanItem): Promise<void> => {
    const path = item.path === undefined ? "" : screen.path(item.path);
    const size = item.size === undefined || item.size === 0 ? "" : `  ${megabytes(item.size)}`;
    const tail = `${path}${size}`;
    if (tail === "") return screen.line(`  ${screen.mark(tone)} ${item.label}`);
    // A line too wide for the terminal puts the path under its label instead of wrapping it.
    if (6 + width + tail.length > screen.columns) {
      await screen.line(`  ${screen.mark(tone)} ${item.label}`);
      return screen.line(`      ${screen.dim(tail)}`);
    }
    return screen.line(`  ${screen.mark(tone)} ${item.label.padEnd(width)}  ${screen.dim(tail)}`);
  };
  await screen.heading("This removes:");
  for (const item of plan.remove) await line("info", item);
  await screen.heading("This keeps:");
  for (const item of plan.keep) await line("ok", item);
  await screen.line();
}

type Choices = { readonly purge: boolean; readonly removeMcp: boolean };

async function choices(
  screen: Screen,
  flags: Flags,
  registrations: readonly Registration[],
  configDir: string,
): Promise<Choices> {
  const given = { purge: flags.purge, removeMcp: !flags.keepMcp };
  const purge = flags.purge
    ? true
    : await screen.confirm(`Also remove your settings in ${screen.path(configDir)}?`, {
        default: false,
        fallback: given.purge,
      });
  const removeMcp =
    registrations.length === 0 || flags.keepMcp
      ? given.removeMcp
      : await screen.confirm(
          `Remove the MCP registration${registrations.length === 1 ? "" : "s"} ${productName} made with ${[
            ...new Set(registrations.map((r) => agentLabels[r.agent])),
          ].join(", ")}?`,
          { default: true, fallback: given.removeMcp },
        );
  return { purge, removeMcp };
}

/** Stops what runs from the install, after the person agreed; a cancel otherwise. */
async function stopRunning(
  screen: Screen,
  processes: readonly Running[] | undefined,
  yes: boolean,
) {
  if (processes === undefined) {
    await screen.callout("warn", "The running processes could not be listed.", [
      `A ${productName} daemon still running would stop working once its files are gone.`,
    ]);
    return;
  }
  if (processes.length === 0) return;
  const count =
    processes.length === 1 ? "1 process runs" : `${String(processes.length)} processes run`;
  await screen.callout("warn", `${count} from ${productName}:`);
  await screen.rows(
    processes.map(({ pid, what }) => [String(pid), what]),
    4,
  );
  const agreed = await screen.confirm(
    `Stop ${processes.length === 1 ? "it" : "them"}? Notebooks are saved first.`,
    { default: true, fallback: yes },
  );
  if (!agreed) {
    await screen.line(
      `Cancelled. Nothing was removed: ${productName} cannot be removed while it runs.`,
    );
    throw new Declined({ command: "uninstall" });
  }
}

async function removeAll(installed: Installed, facts: UninstallFacts, io: Io): Promise<string[]> {
  const { dataDir, record } = installed;
  const notes: string[] = [];
  if (facts.owned) await rm(record.bin, { force: true });
  await cleanProfiles(facts.profiles, record.created);
  if (facts.removeMcp) {
    for (const registration of facts.registrations) notes.push(await unregister(io, registration));
  }
  await sweepLeftovers(dataDir);
  for (const name of ["versions", "duckdb", "install.json", "mcp.json"]) {
    await rm(join(dataDir, name), { recursive: true, force: true });
  }
  if (facts.purge) await rm(facts.configDir, { recursive: true, force: true });
  return notes.filter((note) => note !== "" && !note.includes(": removed"));
}

async function gather(io: Io, installed: Installed, chosen: Choices): Promise<UninstallFacts> {
  const { dataDir, record } = installed;
  const versions = [];
  for (const version of await installedVersions(dataDir)) {
    versions.push({ version, size: await sizeOf(join(versionsDirOf(dataDir), version)) });
  }
  return {
    dataDir,
    versions,
    duckdb: await sizeOf(join(dataDir, "duckdb")),
    bin: record.bin,
    owned: await launcherOwned(record.bin, dataDir),
    profiles: await markedProfiles(io, record),
    configDir: userConfigDir(io.env),
    purge: chosen.purge,
    registrations: await readRegistrations(dataDir),
    removeMcp: chosen.removeMcp,
  };
}

/** The plan with the defaults, the choices, and the plan again when they changed it. */
async function planned(screen: Screen, io: Io, installed: Installed, flags: Flags) {
  const registrations = await readRegistrations(installed.dataDir);
  const given = { purge: flags.purge, removeMcp: !flags.keepMcp };
  await screen.heading(`${productName} uninstall`);
  await screen.line();
  await showPlan(screen, uninstallPlan(await gather(io, installed, given)));
  const chosen = await choices(screen, flags, registrations, userConfigDir(io.env));
  const facts = await gather(io, installed, chosen);
  if (chosen.purge !== given.purge || chosen.removeMcp !== given.removeMcp) {
    await screen.line();
    await showPlan(screen, uninstallPlan(facts));
  }
  return facts;
}

/** Stops what runs and removes everything in the plan, holding the lock; then says what went. */
async function apply(
  screen: Screen,
  io: Io,
  installed: Installed,
  plan: { readonly facts: UninstallFacts; readonly processes: readonly Running[] | undefined },
): Promise<Removed> {
  const { facts, processes } = plan;
  const notes = await withLock(installed.dataDir, async () => {
    if (processes !== undefined && processes.length > 0) {
      await stopAll(processes.map(({ pid }) => pid));
      const count = processes.length === 1 ? "1 process" : `${String(processes.length)} processes`;
      await screen.step("ok", `Stopped ${count}`);
    }
    return removeAll(installed, facts, io);
  });
  await rmdir(installed.dataDir).catch(() => undefined); // only when nothing else is in it
  const removed = uninstallPlan(facts).remove;
  for (const item of removed) {
    const where = item.path === undefined ? "" : screen.path(item.path);
    await screen.step("ok", `Removed ${item.label}`, where);
  }
  for (const note of notes) await screen.step("info", note);
  await screen.line();
  const purged = facts.purge ? " Your settings too." : "";
  await screen.callout("ok", `${productName} is removed.${purged}`, ["To install it again:"]);
  const reinstall = reinstallCommand(io, installed.releases);
  await screen.command(reinstall);
  return {
    removed: removed.map((item) => ({
      label: item.label,
      ...(item.path === undefined ? {} : { path: item.path }),
    })),
    notes,
    purge: facts.purge,
    reinstall,
  };
}

/** What `uninstall --json` prints. */
type Removed = {
  readonly removed: readonly { readonly label: string; readonly path?: string }[];
  readonly notes: readonly string[];
  readonly purge: boolean;
  readonly reinstall: string;
};

/** How to install again: from the releases the build names, or from NIMBO_INSTALL_BASE when it is set. */
function reinstallCommand(io: Io, releases: string): string {
  const base = (io.env.NIMBO_INSTALL_BASE ?? "").replace(/\/+$/u, "");
  if (base === "") return `curl -fsSL ${releases}/latest/download/install.sh | sh`;
  const env = `NIMBO_INSTALL_BASE=${shellWord(base, "")}`;
  if (/^https?:\/\//u.test(base))
    return `curl -fsSL ${shellWord(`${base}/latest/download/install.sh`, "")} | ${env} sh`;
  const folder = base.replace(/^file:\/\//u, "");
  return `${env} sh ${shellWord(`${folder}/latest/download/install.sh`, io.env.HOME ?? "")}`;
}

async function uninstall(
  screen: Screen,
  io: Io,
  installed: Installed,
  flags: Flags,
): Promise<Removed> {
  const facts = await planned(screen, io, installed, flags);
  const processes = await running(io, installed.dataDir);
  if (!screen.interactive && !flags.yes) {
    const how = `Run ${productName} uninstall --yes to remove it without questions.`;
    await screen.line(`Nothing was removed. ${how}`);
    throw new Declined({ command: "uninstall" });
  }
  await stopRunning(screen, processes, true);
  if (!(await screen.confirm(`Remove ${productName}?`, { default: false, fallback: true }))) {
    await screen.line("Cancelled. Nothing was removed.");
    throw new Declined({ command: "uninstall" });
  }
  screen.signal.throwIfAborted();
  return apply(screen, io, installed, { facts, processes });
}

type Flags = { readonly purge: boolean; readonly keepMcp: boolean; readonly yes: boolean };

async function runUninstall(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut(
    "uninstall",
    argv,
    { purge: { type: "boolean" }, "keep-mcp": { type: "boolean" } },
    { min: 0, max: 0 },
  );
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const installed = installedOf(await findInstallation());
  const flags = {
    purge: args.values.purge === true,
    keepMcp: args.values["keep-mcp"] === true,
    yes: args.values.yes === true,
  };
  return withScreen(io, "uninstall", { yes: flags.yes, json: args.json }, async (screen) => {
    let removed: Removed;
    try {
      removed = await uninstall(screen, io, installed, flags);
    } catch (error) {
      if (screen.signal.aborted) throw new Interrupted({ command: "uninstall" });
      throw explained(error, "The uninstall");
    }
    if (args.json) await write(io.stdout, `${JSON.stringify(removed)}\n`);
    return exitCodes.ok;
  });
}

export const uninstallShortcut: Shortcut = {
  name: "uninstall",
  usage: "uninstall [--purge] [--keep-mcp] [--yes]",
  summary: `remove ${productName} from this machine (settings stay unless --purge)`,
  help,
  run: runUninstall,
};
