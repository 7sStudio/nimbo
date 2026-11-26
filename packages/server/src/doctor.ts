// The daemon side of `doctor`: a process entry the CLI runs with the same Node and finds the way it finds
// the daemon's, which loads what the daemon loads and prints one JSON line: esbuild (bundles and the transform's
// output), TypeScript (the language service), the DuckDB binding (by running one query), the vendored js-debug and the
// package manager notebook installs would use.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { createNodeSqlEngine } from "@jsnb/query-sql/node";

import { duckdbStatus } from "./files/duckdb/duckdb.js";
import { managerFor, managerPath } from "./files/packages/manager.js";

const run = promisify(execFile);

type Check = { readonly ok: boolean; readonly detail: string };

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

async function esbuildCheck(): Promise<Check> {
  try {
    const esbuild = await import("esbuild");
    await esbuild.transform("let a: number = 1", { loader: "ts" });
    return { ok: true, detail: esbuild.version };
  } catch (error) {
    return { ok: false, detail: message(error) };
  }
}

async function typescriptCheck(): Promise<Check> {
  try {
    const ts = await import("typescript");
    return { ok: true, detail: ts.version };
  } catch (error) {
    return { ok: false, detail: message(error) };
  }
}

async function duckdbCheck(): Promise<
  Check & { readonly installed: boolean; readonly source: string }
> {
  const status = duckdbStatus();
  if (!status.installed)
    return {
      ok: true,
      installed: false,
      source: status.source,
      detail: `not installed (${status.version})`,
    };
  const directory = await mkdtemp(join(tmpdir(), "doctor-sql-"));
  const engine = createNodeSqlEngine({ directory });
  try {
    await engine.query("select 42 as answer");
    return {
      ok: true,
      installed: true,
      source: status.source,
      detail: `${status.version}, ${status.source}`,
    };
  } catch (error) {
    return { ok: false, installed: true, source: status.source, detail: message(error) };
  } finally {
    await engine.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}

async function jsDebugCheck(): Promise<Check & { readonly present: boolean }> {
  const folder = fileURLToPath(new URL("../vendor/js-debug", import.meta.url));
  if (!existsSync(folder)) return { ok: true, present: false, detail: "not bundled" };
  const version = (await readFile(join(folder, "VERSION"), "utf8").catch(() => "")).trim();
  return { ok: true, present: true, detail: version === "" ? "bundled" : `bundled, ${version}` };
}

/** The npm beside the Node running the daemon: the bundled one in a release. */
async function npmCheck(): Promise<Check> {
  const npm = join(dirname(process.execPath), "npm");
  if (!existsSync(npm)) return { ok: false, detail: `no npm beside ${process.execPath}` };
  try {
    const { stdout } = await run(npm, ["--version"], {
      timeout: 20_000,
      env: { ...process.env, PATH: managerPath() },
    });
    return { ok: true, detail: `npm ${stdout.trim()} (${npm})` };
  } catch (error) {
    return { ok: false, detail: message(error) };
  }
}

/** The package manager this folder's notebook installs use: its lockfile's, else the first on PATH. */
async function managerCheck(): Promise<
  Check & { readonly manager: string; readonly path: string }
> {
  const path = managerPath();
  const manager = managerFor(process.cwd(), "auto", path);
  const found = path
    .split(delimiter)
    .map((folder) => join(folder, manager))
    .find((file) => existsSync(file));
  if (found === undefined)
    return { ok: false, manager, path: "", detail: `${manager} is not on PATH` };
  try {
    const { stdout } = await run(found, ["--version"], {
      timeout: 20_000,
      env: { ...process.env, PATH: path },
    });
    return { ok: true, manager, path: found, detail: `${manager} ${stdout.trim()}` };
  } catch (error) {
    return { ok: false, manager, path: found, detail: message(error) };
  }
}

const [esbuild, typescript, duckdb, jsDebug, npm, packageManager] = await Promise.all([
  esbuildCheck(),
  typescriptCheck(),
  duckdbCheck(),
  jsDebugCheck(),
  npmCheck(),
  managerCheck(),
]);
// DuckDB's handles and esbuild's service may outlive the checks: the answer is complete once written.
process.stdout.write(
  `${JSON.stringify({ esbuild, typescript, duckdb, jsDebug, npm, packageManager })}\n`,
  () => {
    process.exit(0);
  },
);
