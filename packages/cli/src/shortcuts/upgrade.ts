// `upgrade`: asked for, never in the background. It reads the release's manifest,
// installs the newer version beside the running one, points the launcher at it and removes the versions nothing runs
// from; a version a daemon still runs from stays until that daemon stops, and the workspaces it serves are named.
// Only the installer's installs upgrade this way: Homebrew's and a checkout get the command that updates them.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

import { JsnbError, productName } from "@jsnb/core";

import { Interrupted, InvalidArguments } from "../errors/cli.js";
import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import { explained, InstallBusy, InstallFailed } from "../install/errors.js";
import type { InstallRecord, Installation, Release } from "../install/installation.js";
import { findInstallation } from "../install/installation.js";
import type { Sweep } from "../install/local.js";
import {
  installedVersions,
  pointLauncher,
  recentDaemons,
  sweepLeftovers,
  sweepVersions,
  unpackVersion,
  versionsRunning,
} from "../install/local.js";
import { lockDirOf, lockHolder, withLock } from "../install/lock.js";
import type { Artefact, Manifest } from "../install/manifest.js";
import {
  fetchBytes,
  parseManifest,
  releaseFolder,
  ReleaseMissing,
  verifyArtefact,
} from "../install/manifest.js";
import { isReleaseVersion, planUpgrade } from "../install/versions.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import type { Screen } from "../io/screen.js";
import { megabytes, shellWord, withScreen } from "../io/screen.js";
import type { Shortcut } from "./shortcut.js";
import { readShortcut, stringOf } from "./shortcut.js";

const run = promisify(execFile);

const help = `${productName} upgrade: install the latest release beside this one

Shows the installed and the available version, asks, then downloads the release for this machine, checks its
SHA-256, unpacks it beside the installed version and points the command at it. A version a daemon still runs
from is kept until that daemon stops (the workspaces to restart are named, and you can restart them now); every
other old version is removed. Nothing is checked in the background: this command is the only way an update
happens.

Options:
  --check           only say whether a newer release exists
  --version <v>     install release <v> (a downgrade or a repair too)
  -y, --yes         do not ask
  --json            the outcome as JSON

NIMBO_INSTALL_BASE overrides the releases URL (an https URL, a file:// URL or a folder).
`;

/** The install is not the installer's: the command that updates it instead. */
export class UpgradeElsewhere extends JsnbError {
  declare readonly data: {
    readonly method: string;
    readonly how: string;
    readonly command: string;
  };
  constructor(data: { readonly method: string; readonly how: string; readonly command: string }) {
    super({
      name: "UpgradeElsewhere",
      message:
        data.command === ""
          ? `This ${productName} runs from a source checkout: there is nothing to uninstall; delete the checkout when you no longer need it.`
          : `This ${productName} was installed ${data.how}; use: ${data.command}`,
      data,
    });
  }
}

/** How an install that is not the installer's is updated. */
function updateCommand(installation: Installation): string {
  if (installation.method === "homebrew") return `brew upgrade ${productName}`;
  if (installation.method === "source") return "git pull && pnpm install && pnpm run build";
  const releases = installation.release?.releases ?? "";
  return `curl -fsSL ${releases}/latest/download/install.sh | sh`;
}

export const howOf = (method: string): string =>
  method === "homebrew"
    ? "with Homebrew"
    : method === "source"
      ? "from a source checkout"
      : "from a tarball, not by the installer";

const releasesBase = (io: Io, installation: Installation): string => {
  const base = io.env.NIMBO_INSTALL_BASE ?? "";
  return base === "" ? (installation.release?.releases ?? "") : base;
};

type Kept = { readonly version: string; readonly workspaces: readonly string[] };

type Outcome = {
  readonly installed: string;
  readonly latest: string;
  readonly action: "current" | "available" | "installed";
  readonly removed: readonly string[];
  readonly kept: readonly Kept[];
};

type Installer = {
  readonly release: Release;
  readonly dataDir: string;
  readonly record: InstallRecord;
};

/** The installer's parts of `installation`, or UpgradeElsewhere naming the command that updates it. */
function installerOf(installation: Installation): Installer {
  const { release, dataDir, record } = installation;
  if (installation.method === "installer" && release && dataDir !== undefined && record) {
    return { release, dataDir, record };
  }
  throw new UpgradeElsewhere({
    method: installation.method,
    how: howOf(installation.method),
    command: updateCommand(installation),
  });
}

/** The manifest of the release asked for (or the latest), checked against what was asked. */
async function readRelease(
  base: string,
  version: string | undefined,
  target: string,
): Promise<{ folder: string; manifest: Manifest; artefact: Artefact }> {
  const folder = releaseFolder(base, version);
  const url = `${folder}/manifest.json`;
  let manifest: Manifest;
  try {
    manifest = parseManifest(await fetchBytes(url), url);
  } catch (error) {
    if (!(error instanceof ReleaseMissing)) throw error;
    throw version === undefined
      ? new InstallFailed({
          what: `No ${productName} release was found at ${base}.`,
          todo: "Check NIMBO_INSTALL_BASE, or try again later.",
        })
      : new InstallFailed({
          what: `${productName} ${version} does not exist.`,
          todo: `See the releases at ${base}, or run ${productName} upgrade without --version for the latest.`,
        });
  }
  if (version !== undefined && manifest.version !== version) {
    throw new InstallFailed({
      what: `The release folder for ${version} holds ${productName} ${manifest.version}.`,
      todo: "The release looks wrong; report it.",
    });
  }
  return { folder, manifest, artefact: artefactOf(manifest, target) };
}

/** This target's tarball in the manifest, named as a release names it. */
function artefactOf(manifest: Manifest, target: string): Artefact {
  const artefact = manifest.targets[target];
  if (artefact === undefined) {
    throw new InstallFailed({
      what: `${productName} ${manifest.version} has no build for ${target}.`,
      todo: "Pick another release with --version.",
    });
  }
  if (artefact.file !== `${productName}-${manifest.version}-${target}.tar.gz`) {
    throw new InstallFailed({
      what: `The manifest names an unexpected file: ${artefact.file}.`,
      todo: "The release looks wrong; report it.",
    });
  }
  return artefact;
}

/** The versions kept because something runs from them, with the recent workspaces whose daemon that is. */
async function keptFor(io: Io, kept: ReadonlyMap<string, readonly number[]>): Promise<Kept[]> {
  const daemons = await recentDaemons(io.env);
  return [...kept].map(([version, pids]) => ({
    version,
    workspaces: daemons.filter((daemon) => pids.includes(daemon.pid)).map((daemon) => daemon.root),
  }));
}

/** Downloads, checks and unpacks the release, unless that version is installed and something runs from it. */
async function installVersion(
  screen: Screen,
  installer: Installer,
  release: { folder: string; manifest: Manifest; artefact: Artefact },
): Promise<void> {
  const { dataDir } = installer;
  const { folder, manifest, artefact } = release;
  const running = await versionsRunning(dataDir);
  const already = (await installedVersions(dataDir)).includes(manifest.version);
  // A version some process runs from (or might: the processes could not be listed) is never unpacked over.
  if (already && (running === undefined || running.has(manifest.version))) {
    await screen.step("ok", `${manifest.version} is installed already and in use; kept as it is`);
    return;
  }
  const url = `${folder}/${artefact.file}`;
  const bar = screen.progress("Downloading", artefact.size);
  let tarball: Uint8Array;
  try {
    tarball = await fetchBytes(url, {
      signal: screen.signal,
      onProgress: (received) => {
        bar.update(received);
      },
    });
  } catch (error) {
    if (screen.signal.aborted) await bar.end("fail", "Cancelled", "nothing was changed");
    else await bar.end("fail", "Download failed");
    throw error;
  }
  await bar.end("ok", "Downloaded", `${artefact.file}, ${megabytes(artefact.size)}`);
  verifyArtefact(tarball, artefact, url);
  await screen.step("ok", "Checksum verified", "SHA-256 and size match the release");
  screen.signal.throwIfAborted();
  const top = artefact.file.replace(/\.tar\.gz$/u, "");
  const target = await unpackVersion(dataDir, tarball, top, manifest.version);
  await screen.step("ok", "Unpacked", screen.path(target));
}

async function showKept(screen: Screen, outcome: Outcome, home: string): Promise<void> {
  for (const { version, workspaces } of outcome.kept) {
    if (workspaces.length === 0) {
      await screen.callout("warn", `Kept ${version}: a process still runs from it.`, [
        `It is removed by the next ${productName} upgrade or ${productName} stop once nothing runs from it.`,
      ]);
      continue;
    }
    const count =
      workspaces.length === 1 ? "1 workspace" : `${String(workspaces.length)} workspaces`;
    await screen.callout(
      "warn",
      `Kept ${version}: ${count} still ${workspaces.length === 1 ? "runs" : "run"} it. Restart to use ${outcome.latest}:`,
    );
    for (const root of workspaces)
      await screen.command(
        `cd ${shellWord(root, home)} && ${productName} stop && ${productName} open`,
      );
  }
}

/** Stops each workspace's old daemon and starts the new version's in the background. */
async function restart(
  screen: Screen,
  io: Io,
  bin: string,
  roots: readonly string[],
): Promise<void> {
  for (const root of roots) {
    try {
      const options = { cwd: root, env: { ...io.env }, timeout: 60_000 };
      await run(bin, ["stop"], options);
      await run(bin, ["open", "--no-browser", "--background"], options);
      await screen.step("ok", "Restarted", screen.path(root));
    } catch {
      await screen.step("fail", "Could not restart", screen.path(root));
      await screen.command(
        `cd ${shellWord(root, io.env.HOME ?? "")} && ${productName} stop && ${productName} open`,
      );
    }
  }
  await screen.line(
    `  ${screen.dim(`The old version goes with the next ${productName} upgrade or ${productName} stop.`)}`,
  );
}

type Options = {
  readonly check: boolean;
  readonly version: string | undefined;
  readonly json: boolean;
  readonly yes: boolean;
};

async function intro(
  screen: Screen,
  installer: Installer,
  release: { manifest: Manifest; artefact: Artefact },
  base: string,
): Promise<void> {
  const { manifest, artefact } = release;
  await screen.rows([
    ["Installed", installer.release.version],
    ["Available", `${screen.strong(manifest.version)}  ${screen.dim(`from ${base}`)}`],
  ]);
  await screen.line();
  await screen.line(`This downloads ${artefact.file} (${megabytes(artefact.size)}),`);
  await screen.line(
    `installs it in ${screen.path(join(installer.dataDir, "versions", manifest.version))}`,
  );
  await screen.line(`and points ${screen.path(installer.record.bin)} at it.`);
  await screen.line();
}

/** Installs the release found, after a yes, under the lock: download, check, unpack, link, sweep. */
async function install(
  screen: Screen,
  installer: Installer,
  found: { folder: string; manifest: Manifest; artefact: Artefact },
  base: string,
): Promise<Sweep | undefined> {
  const { dataDir, record } = installer;
  const { manifest } = found;
  const busy = await lockHolder(dataDir);
  if (busy !== undefined) throw new InstallBusy({ ...busy, lock: lockDirOf(dataDir) });
  await intro(screen, installer, found, base);
  if (!(await screen.confirm(`Install ${productName} ${manifest.version}?`, { default: true }))) {
    await screen.line("Nothing was changed.");
    return undefined;
  }
  // A second upgrade at once stops at once rather than wait and install the same release again.
  return withLock(
    dataDir,
    async () => {
      await sweepLeftovers(dataDir);
      await installVersion(screen, installer, found);
      await pointLauncher(
        record.bin,
        join(dataDir, "versions", manifest.version, "bin", productName),
      );
      const linked = `${screen.path(record.bin)} ${screen.mark("arrow")} ${manifest.version}`;
      await screen.step("ok", "Linked", linked);
      const swept = await sweepVersions(dataDir, manifest.version);
      for (const version of swept.removed) await screen.step("ok", "Removed", version);
      return swept;
    },
    { waitMs: 0 },
  );
}

async function upgrade(
  screen: Screen,
  io: Io,
  installation: Installation,
  options: Options,
): Promise<Outcome> {
  const installer = installerOf(installation);
  const { release, dataDir } = installer;
  const base = releasesBase(io, installation);
  const found = await readRelease(base, options.version, release.target);
  const plan = planUpgrade(release.version, found.manifest.version, options.version !== undefined);
  const facts = { installed: release.version, latest: found.manifest.version };
  const nothing = { removed: [], kept: [] };
  if (options.check) {
    return { ...facts, action: plan.kind === "current" ? "current" : "available", ...nothing };
  }
  const sweep =
    plan.kind === "current"
      ? await withLock(dataDir, async () => {
          await sweepLeftovers(dataDir);
          return sweepVersions(dataDir, release.version);
        })
      : await install(screen, installer, found, base);
  if (sweep === undefined) return { ...facts, action: "available", ...nothing };
  const action = plan.kind === "current" ? "current" : "installed";
  return { ...facts, action, removed: sweep.removed, kept: await keptFor(io, sweep.kept) };
}

async function human(screen: Screen, io: Io, record: InstallRecord | undefined, outcome: Outcome) {
  const name = productName;
  if (outcome.action === "current") {
    await screen.step("ok", `${name} ${outcome.installed} is the latest release.`);
  } else if (outcome.action === "available") {
    await screen.step(
      "info",
      `${name} ${outcome.latest} is available`,
      `you have ${outcome.installed}`,
    );
    await screen.command(`${name} upgrade`, "installs it");
  } else {
    await screen.line();
    await screen.callout("ok", `${name} ${outcome.latest} is installed; ${name} now runs it.`);
  }
  if (outcome.kept.length > 0) await screen.line();
  if (outcome.kept.length === 0) return;
  await showKept(screen, outcome, io.env.HOME ?? "");
  const roots = outcome.kept.flatMap((kept) => kept.workspaces);
  if (record === undefined || roots.length === 0) return;
  if (
    await screen.confirm(`Restart ${roots.length === 1 ? "it" : "them"} now?`, { default: false })
  ) {
    await restart(screen, io, record.bin, roots);
  }
}

async function runUpgrade(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut(
    "upgrade",
    argv,
    { check: { type: "boolean" }, version: { type: "string" } },
    { min: 0, max: 0 },
  );
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const asked = stringOf(args.values.version)?.replace(/^v/u, "");
  if (asked !== undefined && !isReleaseVersion(asked)) {
    throw new InvalidArguments(
      { argument: "--version", command: "upgrade" },
      `${JSON.stringify(asked)} is not a version such as 0.2.0.`,
    );
  }
  const options = {
    check: args.values.check === true,
    version: asked,
    json: args.json,
    yes: args.values.yes === true,
  };
  const installation = await findInstallation();
  return withScreen(io, "upgrade", options, async (screen) => {
    let outcome: Outcome;
    try {
      outcome = await upgrade(screen, io, installation, options);
    } catch (error) {
      if (screen.signal.aborted) throw new Interrupted({ command: "upgrade" });
      throw explained(error, "The upgrade");
    }
    if (options.json) await write(io.stdout, `${JSON.stringify(outcome)}\n`);
    else await human(screen, io, installation.record, outcome);
    return exitCodes.ok;
  });
}

export const upgradeShortcut: Shortcut = {
  name: "upgrade",
  usage: "upgrade [--check] [--version <v>] [--yes]",
  summary: `install the latest ${productName} release beside this one`,
  help,
  run: runUpgrade,
};
