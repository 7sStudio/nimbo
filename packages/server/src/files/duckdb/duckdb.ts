// The daemon's DuckDB binding on demand: `@duckdb/node-api` is not part of the app; it is
// loaded from the package's own dependency when there is one (a checkout), else from
// `<data>/duckdb/<version>/node_modules`, outside any app version so an upgrade keeps it. `sql.install` puts it there:
// the three npm tarballs (the API, the bindings and this platform's native package) fetched from the registry, each
// checked against the integrity the lockfile pinned, unpacked into a hidden folder and renamed into place at once.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { JsnbError, productDataDir } from "@jsnb/core";
import { findDuckdb, useDuckdbFolder } from "@jsnb/query-sql/node";

import { withDataLock } from "./lock.js";
import { duckdbPins } from "./pins.js";

const run = promisify(execFile);

export type DuckdbStatus = {
  readonly installed: boolean;
  readonly version: string;
  /** `dependency`: beside query-sql (a checkout); `installed`: in the data folder; `missing`. */
  readonly source: "dependency" | "installed" | "missing";
  /** The folder `sql.install` installs into. */
  readonly folder: string;
};

export type DuckdbProgress = {
  readonly step: "download" | "verify" | "unpack" | "ready";
  readonly package: string;
  readonly index: number;
  readonly count: number;
};

/** No binding was published for this platform: a release targets macOS and Linux on arm64 and x64 only. */
class SqlPlatformUnsupported extends JsnbError {
  declare readonly data: { readonly platform: string };
  constructor(data: { readonly platform: string }) {
    super({
      name: "SqlPlatformUnsupported",
      message: `DuckDB's native binding is not available for ${data.platform}: only macOS and Linux on arm64 and x64 are supported.`,
      data,
    });
  }
}

/** A download or an unpack of the binding failed; what was there before is left as it was. */
class SqlInstallFailed extends JsnbError {
  declare readonly data: { readonly package: string; readonly reason: string };
  constructor(
    data: { readonly package: string; readonly reason: string },
    options: { cause?: unknown } = {},
  ) {
    super({
      name: "SqlInstallFailed",
      message: `DuckDB could not be installed: ${data.package}: ${data.reason}. Nothing was changed; try again.`,
      data,
      ...options,
    });
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/** `<data>/duckdb/<version>`, the folder the binding is installed into. */
const duckdbFolder = (env: Env = process.env): string =>
  join(productDataDir(env, env.HOME ?? homedir()), "duckdb", duckdbPins.version);

/** Makes the engine look in the data folder too; called before any SQL runs. */
export function useInstalledDuckdb(env: Env = process.env): string {
  const folder = duckdbFolder(env);
  useDuckdbFolder(folder);
  return folder;
}

export function duckdbStatus(env: Env = process.env): DuckdbStatus {
  const folder = useInstalledDuckdb(env);
  const found = findDuckdb();
  const source =
    found === undefined
      ? "missing"
      : fileURLToPath(found).startsWith(`${folder}/`)
        ? "installed"
        : "dependency";
  return { installed: found !== undefined, version: duckdbPins.version, source, folder };
}

const registryOf = (env: Env): string =>
  (env.NIMBO_NPM_REGISTRY ?? "https://registry.npmjs.org").replace(/\/+$/u, "");

/** npm's tarball URL: `<registry>/@scope/name/-/name-<version>.tgz`. */
const tarballUrl = (registry: string, name: string): string =>
  `${registry}/${name}/-/${name.split("/").at(-1) ?? name}-${duckdbPins.version}.tgz`;

/** Throws unless `bytes` match npm's `sha512-<base64>` integrity. */
function checkIntegrity(bytes: Uint8Array, integrity: string, name: string): void {
  const [algorithm = "", expected = ""] = integrity.split("-", 2);
  const found = createHash(algorithm).update(bytes).digest("base64");
  if (found !== expected) {
    throw new SqlInstallFailed({
      package: name,
      reason: `the download's ${algorithm} is not the pinned one`,
    });
  }
}

const idleMs = 30_000;

/** A promise of `step` that rejects with `reason` when it takes longer than the idle limit. */
async function within<T>(step: Promise<T>, reason: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(reason));
    }, idleMs);
  });
  try {
    return await Promise.race([step, idle]);
  } finally {
    clearTimeout(timer);
  }
}

/** The response's bytes, each chunk within the idle limit. */
async function body(response: Response, silent: string): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const next: unknown = await within(reader.read(), silent).catch(async (error: unknown) => {
      await reader.cancel().catch(() => undefined);
      throw error;
    });
    if (Reflect.get(Object(next), "done") === true) break;
    const value: unknown = Reflect.get(Object(next), "value");
    if (value instanceof Uint8Array) chunks.push(value);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** The tarball at `url`; the registry may stay silent 30 s at most, before answering or between chunks. */
async function download(url: string, name: string): Promise<Uint8Array> {
  const silent = `the registry sent nothing for ${String(idleMs / 1000)} s`;
  try {
    // Only the answer is timed here; the body's chunks each get the idle limit as they come.
    const waiting = new AbortController();
    const response = await within(fetch(url, { signal: waiting.signal }), silent).catch(
      (error: unknown) => {
        waiting.abort();
        throw error;
      },
    );
    if (!response.ok) throw new Error(`the registry answered ${String(response.status)}`);
    return await body(response, silent);
  } catch (error) {
    if (error instanceof SqlInstallFailed) throw error;
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    const reason = timedOut ? silent : error instanceof Error ? error.message : String(error);
    throw new SqlInstallFailed({ package: name, reason: `${reason} (${url})` }, { cause: error });
  }
}

let running: Promise<DuckdbStatus> | undefined;

type Pin = { readonly name: string; readonly integrity: string };
type Step = { readonly package: string; readonly index: number; readonly count: number };

/** Unpacks a verified npm tarball as `work/node_modules/<name>` and checks it holds the pinned version. */
async function unpack(work: string, pin: Pin, index: number, bytes: Uint8Array): Promise<void> {
  const into = join(work, "node_modules", pin.name);
  await mkdir(into, { recursive: true });
  const file = join(work, `${String(index)}.tgz`);
  await writeFile(file, bytes);
  await run("tar", ["-xzf", file, "-C", into, "--strip-components=1"]).catch((error: unknown) => {
    throw new SqlInstallFailed(
      { package: pin.name, reason: "the tarball could not be unpacked" },
      { cause: error },
    );
  });
  await rm(file);
  const manifest: unknown = JSON.parse(await readFile(join(into, "package.json"), "utf8"));
  if (Reflect.get(Object(manifest), "version") !== duckdbPins.version) {
    throw new SqlInstallFailed({ package: pin.name, reason: "the tarball holds another version" });
  }
}

/** Fetches, checks and unpacks each package into `work`. */
async function fetchAll(
  work: string,
  packages: readonly Pin[],
  registry: string,
  onProgress: (progress: DuckdbProgress) => void,
): Promise<void> {
  for (const [index, pin] of packages.entries()) {
    const at: Step = { package: pin.name, index, count: packages.length };
    onProgress({ step: "download", ...at });
    const bytes = await download(tarballUrl(registry, pin.name), pin.name);
    onProgress({ step: "verify", ...at });
    checkIntegrity(bytes, pin.integrity, pin.name);
    onProgress({ step: "unpack", ...at });
    await unpack(work, pin, index, bytes);
  }
}

async function install(
  env: Env,
  onProgress: (progress: DuckdbProgress) => void,
): Promise<DuckdbStatus> {
  const before = duckdbStatus(env);
  if (before.installed) return before;
  const target = `${process.platform}-${process.arch}`;
  const platform = Object.entries(duckdbPins.platform).find(([name]) => name === target)?.[1];
  if (platform === undefined) throw new SqlPlatformUnsupported({ platform: target });
  const folder = duckdbFolder(env);
  const packages = [...duckdbPins.common, platform];
  // One install at a time across daemons and the installer: under the data folder's lock, what an interrupted one
  // left goes first, and an install another daemon finished meanwhile is taken as it is.
  await withDataLock(dirname(dirname(folder)), async () => {
    await mkdir(dirname(folder), { recursive: true });
    for (const name of await readdir(dirname(folder))) {
      if (name.includes(".partial-"))
        await rm(join(dirname(folder), name), { recursive: true, force: true });
    }
    if (duckdbStatus(env).installed) return;
    const work = await mkdtemp(`${folder}.partial-`);
    try {
      await fetchAll(work, packages, registryOf(env), onProgress);
      await rm(folder, { recursive: true, force: true });
      await rename(work, folder);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  });
  const status = duckdbStatus(env);
  onProgress({ step: "ready", package: "", index: packages.length, count: packages.length });
  return status;
}

/** Installs the binding into the data folder; one install at a time, a second caller waits for the first. */
export function installDuckdb(
  onProgress: (progress: DuckdbProgress) => void,
  env: Env = process.env,
): Promise<DuckdbStatus> {
  running ??= install(env, onProgress).finally(() => {
    running = undefined;
  });
  return running;
}
