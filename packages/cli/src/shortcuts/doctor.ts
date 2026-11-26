// `doctor`: what this install is and whether its parts work. The CLI's side: the Node it runs on, the
// install's method, place, version and commit, the launcher and PATH, the UI build, and the daemons of the recent
// workspaces with their versions; the daemon's side (esbuild, TypeScript, DuckDB, js-debug, the package manager) from
// `@jsnb/server/doctor`, run with the same Node. Exit 1 when something is broken; a warning alone is exit 0.
import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { productCommit, productName, productVersion } from "@jsnb/core";
import { z } from "zod";

import { uiArguments } from "../daemon/ui.js";
import type { ExitCode } from "../errors/exit.js";
import { exitCodes } from "../errors/exit.js";
import { findInstallation } from "../install/installation.js";
import { launcherTarget, leftovers, recentDaemons } from "../install/local.js";
import type { Io } from "../io/io.js";
import { write } from "../io/io.js";
import type { Screen } from "../io/screen.js";
import { shellWord, withScreen } from "../io/screen.js";
import type { Shortcut } from "./shortcut.js";
import { readShortcut } from "./shortcut.js";

const run = promisify(execFile);

const help = `${productName} doctor: check this install

Reports, in groups, how and where ${productName} is installed (its version, the command's link, folders an
interrupted install left), the runtime (Node, the bundled npm, the UI build), the components (esbuild,
TypeScript, DuckDB, js-debug), the daemons of recent workspaces with their versions, PATH, and the package
manager this folder's notebook installs use. Under each problem, the command that fixes it. Exits 1 when
something is broken; a warning alone is exit 0.

Options:
  --json            the checks as JSON
`;

type Level = "ok" | "warn" | "fail";
type Group = "Install" | "Runtime" | "Components" | "Daemons" | "PATH" | "This folder";
const groups: readonly Group[] = [
  "Install",
  "Runtime",
  "Components",
  "Daemons",
  "PATH",
  "This folder",
];

type Check = {
  readonly group: Group;
  readonly name: string;
  readonly level: Level;
  readonly detail: string;
  /** The command (or step) that fixes a warning or a failure. */
  readonly fix?: string;
};

const Probe = z.object({
  esbuild: z.object({ ok: z.boolean(), detail: z.string() }),
  typescript: z.object({ ok: z.boolean(), detail: z.string() }),
  duckdb: z.object({ ok: z.boolean(), installed: z.boolean(), detail: z.string() }),
  jsDebug: z.object({ ok: z.boolean(), present: z.boolean(), detail: z.string() }),
  npm: z.object({ ok: z.boolean(), detail: z.string() }).optional(),
  packageManager: z.object({
    ok: z.boolean(),
    detail: z.string(),
    path: z.string(),
    manager: z.string().optional(),
  }),
});

const level = (ok: boolean, warn = false): Level => (ok ? (warn ? "warn" : "ok") : "fail");

const failed = (name: string, detail: string): Check[] => [
  { group: "Runtime", name, level: "fail", detail, fix: `reinstall ${productName}` },
];

/** The package manager this folder's notebook installs use: a warning when it is missing, not an install problem. */
function folderManager(packageManager: z.infer<typeof Probe>["packageManager"]): Check {
  const manager = packageManager.manager ?? "the package manager";
  if (packageManager.ok) {
    const detail = `${packageManager.detail} (${packageManager.path})`;
    return { group: "This folder", name: "package manager", level: "ok", detail };
  }
  return {
    group: "This folder",
    name: "package manager",
    level: "warn",
    detail: `${packageManager.detail}: notebook installs here need it`,
    fix: `install ${manager}, or set packages.manager (${productName} config set packages.manager npm)`,
  };
}

/** The daemon side's answer as checks. */
function probeChecks(probe: z.infer<typeof Probe>): Check[] {
  const { esbuild, typescript, duckdb, jsDebug, npm } = probe;
  const component = (name: string, ok: boolean, detail: string, warn = false): Check => ({
    group: "Components",
    name,
    level: level(ok, warn),
    detail,
  });
  return [
    ...(npm === undefined
      ? []
      : [{ group: "Runtime" as const, name: "npm", level: level(npm.ok), detail: npm.detail }]),
    component("esbuild", esbuild.ok, esbuild.detail),
    component("typescript", typescript.ok, typescript.detail),
    duckdb.installed
      ? component("duckdb", duckdb.ok, duckdb.detail)
      : {
          ...component(
            "duckdb",
            duckdb.ok,
            "not installed (only SQL from the CLI and agents needs it)",
            true,
          ),
          fix: `${productName} sql install`,
        },
    component("js-debug", jsDebug.ok, jsDebug.detail, !jsDebug.present),
    folderManager(probe.packageManager),
  ];
}

async function daemonSide(io: Io): Promise<Check[]> {
  let entry: string;
  try {
    entry = fileURLToPath(import.meta.resolve("@jsnb/server/doctor"));
  } catch (error) {
    return failed("daemon", `the daemon's package cannot be found (${String(error)})`);
  }
  try {
    const options = { cwd: io.cwd, env: { ...io.env }, timeout: 120_000 };
    const { stdout } = await run(io.execPath, [entry], options);
    return probeChecks(Probe.parse(JSON.parse(stdout)));
  } catch (error) {
    return failed(
      "daemon",
      `the daemon's checks failed: ${error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error)}`,
    );
  }
}

/** The first `name` on PATH, or undefined. */
function onPath(name: string, path: string): string | undefined {
  return path
    .split(delimiter)
    .filter((folder) => folder !== "")
    .map((folder) => join(folder, name))
    .find((file) => existsSync(file));
}

const real = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
};

/** Whether PATH finds the installer's link first. */
function pathCheck(bin: string, found: string | undefined): Check {
  const base = { group: "PATH" as const, name: "path" };
  if (found === undefined) {
    return {
      ...base,
      level: "warn",
      detail: `${productName} is not on PATH`,
      fix: `open a new terminal, or add ${dirname(bin)} to PATH`,
    };
  }
  if (real(found) === real(bin)) return { ...base, level: "ok", detail: found };
  return {
    ...base,
    level: "warn",
    detail: `${found} comes first on PATH, not ${bin}`,
    fix: `remove ${found}, or put ${dirname(bin)} first on PATH`,
  };
}

/** The installer's launcher link, and whether PATH finds it first. */
async function launcherChecks(
  bin: string,
  versionDir: string,
  found: string | undefined,
): Promise<Check[]> {
  const target = await launcherTarget(bin);
  const points = target === undefined ? undefined : resolve(dirname(bin), target);
  const current =
    points !== undefined && real(points) === real(join(versionDir, "bin", productName));
  const launcher: Check = {
    group: "Install",
    name: "launcher",
    level: level(points !== undefined && existsSync(points), !current),
    detail:
      target === undefined
        ? `${bin} is missing`
        : `${bin} → ${target}${current ? "" : ", not this version"}`,
    ...(current ? {} : { fix: `${productName} upgrade --version ${productVersion}` }),
  };
  return [launcher, pathCheck(bin, found)];
}

async function leftoverChecks(dataDir: string | undefined, home: string): Promise<Check[]> {
  if (dataDir === undefined) return [];
  return (await leftovers(dataDir)).map((path) => ({
    group: "Install" as const,
    name: "leftover",
    level: "warn" as const,
    detail: `${path}, left by an interrupted install`,
    fix: `rm -rf ${shellWord(path, home)}  (or ${productName} upgrade, which removes it)`,
  }));
}

async function cliSide(io: Io): Promise<Check[]> {
  const installation = await findInstallation();
  const nodeMajor = Number.parseInt(process.versions.node, 10);
  const ui = await uiArguments(io.env, "doctor").catch(() => []);
  const found = onPath(productName, io.env.PATH ?? "");
  const { record, versionDir } = installation;
  const commit = productCommit === "" ? "" : ` (${productCommit})`;
  return [
    { group: "Install", name: "method", level: "ok", detail: installation.method },
    { group: "Install", name: "location", level: "ok", detail: versionDir ?? installation.appDir },
    { group: "Install", name: "version", level: "ok", detail: `${productVersion}${commit}` },
    ...(record !== undefined && versionDir !== undefined
      ? await launcherChecks(record.bin, versionDir, found)
      : [
          {
            group: "PATH" as const,
            name: "path",
            level: level(true, found === undefined),
            detail: found ?? `${productName} is not on PATH`,
          },
        ]),
    ...(await leftoverChecks(installation.dataDir, io.env.HOME ?? "")),
    {
      group: "Runtime",
      name: "node",
      level: level(nodeMajor >= 26),
      detail: `${process.versions.node} (${io.execPath})`,
    },
    {
      group: "Runtime",
      name: "ui",
      level: level(ui.length > 0),
      detail: ui[1] ?? "no built UI found",
      ...(ui.length > 0 ? {} : { fix: `reinstall ${productName}` }),
    },
  ];
}

async function daemons(io: Io): Promise<Check[]> {
  return (await recentDaemons(io.env)).map((daemon) => ({
    group: "Daemons",
    name: "daemon",
    level: level(true, daemon.version !== productVersion),
    detail:
      daemon.version === productVersion
        ? `${daemon.root} (pid ${String(daemon.pid)}, ${daemon.version})`
        : `${daemon.root} runs ${daemon.version}, not ${productVersion}`,
    ...(daemon.version === productVersion
      ? {}
      : {
          fix: `cd ${shellWord(daemon.root, io.env.HOME ?? "")} && ${productName} stop && ${productName} open`,
        }),
  }));
}

const plural = (count: number, one: string, many: string): string =>
  `${String(count)} ${count === 1 ? one : many}`;

const tone = { ok: "ok", warn: "warn", fail: "fail" } as const;

async function showGroup(screen: Screen, group: Group, checks: readonly Check[], width: number) {
  await screen.line();
  await screen.heading(group);
  if (checks.length === 0) await screen.line(`  ${screen.dim("none running")}`);
  for (const check of checks) {
    const plain = screen.path(check.detail);
    const detail = plain.replaceAll(" → ", ` ${screen.mark("arrow")} `);
    const mark = `  ${screen.mark(tone[check.level])} `;
    // A detail too wide for the terminal goes under its name instead of wrapping into the next column.
    if (6 + width + plain.length > screen.columns) {
      await screen.line(`${mark}${screen.dim(check.name)}`);
      await screen.line(`      ${detail}`);
    } else {
      await screen.line(`${mark}${screen.dim(check.name.padEnd(width))}  ${detail}`);
    }
    if (check.fix !== undefined) {
      await screen.line(`      ${screen.mark("arrow")} ${screen.accent(check.fix)}`);
    }
  }
}

/** "All 14 checks passed.", or how many failed and how many need attention. */
async function summary(screen: Screen, checks: readonly Check[]): Promise<void> {
  const failures = checks.filter((check) => check.level === "fail").length;
  const warnings = checks.filter((check) => check.level === "warn").length;
  await screen.line();
  if (failures + warnings === 0) {
    await screen.callout("ok", `All ${String(checks.length)} checks passed.`);
    return;
  }
  const parts = [
    ...(failures > 0 ? [plural(failures, "check failed", "checks failed")] : []),
    ...(warnings > 0 ? [plural(warnings, "check needs attention", "checks need attention")] : []),
  ];
  await screen.callout(failures > 0 ? "fail" : "warn", `${parts.join(", ")}.`);
}

async function show(screen: Screen, checks: readonly Check[]): Promise<void> {
  const width = Math.max(...checks.map((check) => check.name.length));
  await screen.heading(`${productName} doctor`);
  for (const group of groups) {
    const inGroup = checks.filter((check) => check.group === group);
    if (inGroup.length > 0 || group === "Daemons") await showGroup(screen, group, inGroup, width);
  }
  await summary(screen, checks);
}

async function runDoctor(argv: readonly string[], io: Io): Promise<ExitCode> {
  const args = readShortcut("doctor", argv, {}, { min: 0, max: 0 });
  if (args.help) {
    await write(io.stdout, help);
    return exitCodes.ok;
  }
  const checks = [...(await cliSide(io)), ...(await daemonSide(io)), ...(await daemons(io))];
  const ok = checks.every((check) => check.level !== "fail");
  if (args.json) {
    const plain = checks.map(({ name, level: checked, detail }) => ({
      name,
      level: checked,
      detail,
    }));
    await write(io.stdout, `${JSON.stringify({ ok, checks: plain })}\n`);
  } else {
    await withScreen(io, "doctor", { yes: true }, (screen) => show(screen, checks));
  }
  return ok ? exitCodes.ok : exitCodes.runError;
}

export const doctorShortcut: Shortcut = {
  name: "doctor",
  usage: "doctor",
  summary: "check this install: runtime, parts, PATH and running daemons",
  help,
  run: runDoctor,
};
