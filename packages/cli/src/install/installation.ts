// Where this CLI was installed from and how: a release build carries `release.json` in the CLI's
// own package folder (the app folder of a version), and the version folder above it says the rest: under
// `<data>/versions/` beside the installer's `install.json` is an installer install, an `install-method` file naming
// Homebrew is a formula's, anything else unpacked by hand is a tarball; no release.json is a checkout run from source.
import { readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

export const Release = z.object({
  name: z.string(),
  version: z.string(),
  commit: z.string(),
  target: z.string(),
  node: z.string(),
  /** The releases page the build points at: `<releases>/latest/download/…`, `<releases>/download/v<version>/…`. */
  releases: z.string(),
});
export type Release = z.infer<typeof Release>;

/** What the installer writes beside the versions: the launcher it made and the profile files it added a line to. */
export const InstallRecord = z.object({
  method: z.literal("installer"),
  bin: z.string(),
  profiles: z.array(z.string()),
  /** The profile files the installer created, removed again when nothing but its line was in them. */
  created: z.array(z.string()).default([]),
});
export type InstallRecord = z.infer<typeof InstallRecord>;

type Method = "installer" | "homebrew" | "tarball" | "source";

export type Installation = {
  readonly method: Method;
  /** The CLI's package folder: `app/` of a version, `packages/cli` of a checkout. */
  readonly appDir: string;
  readonly release: Release | undefined;
  /** The version folder (`bin/`, `node/`, `app/`); undefined from source. */
  readonly versionDir: string | undefined;
  /** The installer's data folder (`versions/`, `duckdb/`, `install.json`); only for an installer install. */
  readonly dataDir: string | undefined;
  readonly record: InstallRecord | undefined;
};

async function readJson<T>(path: string, schema: z.ZodType<T>): Promise<T | undefined> {
  try {
    const parsed = schema.safeParse(JSON.parse(await readFile(path, "utf8")));
    return parsed.success ? parsed.data : undefined;
  } catch {
    // Missing or not JSON: not that kind of install.
    return undefined;
  }
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return (await readFile(path, "utf8")).trim();
  } catch {
    // Missing: no marker.
    return undefined;
  }
}

/** The CLI's package folder, two levels above this module (src/install/ and dist/install/ alike). */
const ownAppDir = (): string => fileURLToPath(new URL("../..", import.meta.url));

/** How the CLI whose package folder is `appDir` was installed. */
export async function findInstallation(appDir: string = ownAppDir()): Promise<Installation> {
  const release = await readJson(join(appDir, "release.json"), Release);
  if (release === undefined) {
    return {
      method: "source",
      appDir,
      release,
      versionDir: undefined,
      dataDir: undefined,
      record: undefined,
    };
  }
  const versionDir = dirname(appDir);
  const base = { appDir, release, versionDir };
  if ((await readText(join(versionDir, "install-method"))) === "homebrew") {
    return { ...base, method: "homebrew", dataDir: undefined, record: undefined };
  }
  const versionsDir = dirname(versionDir);
  const dataDir = dirname(versionsDir);
  const record =
    basename(versionsDir) === "versions"
      ? await readJson(join(dataDir, "install.json"), InstallRecord)
      : undefined;
  return record === undefined
    ? { ...base, method: "tarball", dataDir: undefined, record: undefined }
    : { ...base, method: "installer", dataDir, record };
}
