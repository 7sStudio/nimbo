// The workspace package.json of 03-api §4.6 and 07-file-format §7: the packages it declares, and the file packages.add
// creates as `{ "private": true, "type": "module" }` when there is none; the fields the daemon reads are checked with Zod
// (08 §5), an installed package's version too. Both files are read non-blocking and only as regular files: a FIFO in their place never holds a thread of libuv's pool.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { JsnbError } from "@jsnb/core";
import { z } from "zod";

import { readRegularFile } from "../regularFile.js";

export type DeclaredPackage = { readonly name: string; readonly version: string };

type Where = { readonly path: string; readonly reason: string };
const unreadableMessage = ({ path, reason }: Where): string =>
  `${path} could not be read (${reason}). Fix the file so it is valid JSON, then try again.`;

/** The workspace package.json exists but is not a JSON object. */
class ManifestUnreadable extends JsnbError {
  declare readonly data: Where;
  constructor(data: Where, options: { readonly cause?: unknown } = {}) {
    super({ name: "ManifestUnreadable", message: unreadableMessage(data), data, ...options });
  }
}

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

/** A package.json is hand-written or generated metadata: far below this. */
const maxManifestBytes = 4 * 1024 * 1024;

/** A dependency map; a field of another shape declares nothing (the file stays the user's). */
const Ranges = z.record(z.string(), z.unknown()).optional().catch(undefined);

/** The fields of a package.json the daemon reads; the rest of the file is the user's. */
const Manifest = z.looseObject({ dependencies: Ranges, devDependencies: Ranges });
type Manifest = z.infer<typeof Manifest>;

/** An installed package's own package.json, for its version. */
const Installed = z.looseObject({ version: z.string() });

/** The parsed package.json of `workspace`, or undefined when there is none. */
async function readManifest(workspace: string): Promise<Manifest | undefined> {
  const path = join(workspace, "package.json");
  const read = await readRegularFile(path, maxManifestBytes);
  if (read.kind === "missing") return undefined;
  if (read.kind === "refused") throw new ManifestUnreadable({ path, reason: read.reason });
  const { text } = read;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ManifestUnreadable({ path, reason: "it is not valid JSON" }, { cause: error });
  }
  const manifest = Manifest.safeParse(json);
  if (!manifest.success) throw new ManifestUnreadable({ path, reason: "it is not a JSON object" });
  return manifest.data;
}

const entriesOf = (field: Readonly<Record<string, unknown>> | undefined): DeclaredPackage[] =>
  Object.entries(field ?? {}).flatMap(([name, version]) =>
    typeof version === "string" ? [{ name, version }] : [],
  );

/** The dependencies and devDependencies the workspace declares, with their ranges as written. */
export async function declaredPackages(workspace: string): Promise<readonly DeclaredPackage[]> {
  const manifest = await readManifest(workspace);
  if (!manifest) return [];
  return [...entriesOf(manifest.dependencies), ...entriesOf(manifest.devDependencies)];
}

/** Writes `{ "private": true, "type": "module" }` when the workspace has no package.json. */
export async function ensureManifest(workspace: string): Promise<void> {
  const text = `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`;
  try {
    await writeFile(join(workspace, "package.json"), text, { flag: "wx" });
  } catch (error) {
    if (codeOf(error) !== "EEXIST") throw error; // the workspace already has its own
  }
}

/** The version `node_modules/<name>/package.json` holds, or undefined when the package is not installed. */
export const installedVersion = (workspace: string, name: string): Promise<string | undefined> =>
  versionAt(join(workspace, "node_modules", name));

/** The version the package.json of the package `folder` holds, or undefined when there is none to read. */
export async function versionAt(folder: string): Promise<string | undefined> {
  const path = join(folder, "package.json");
  const read = await readRegularFile(path, maxManifestBytes);
  if (read.kind !== "read") return undefined; // not installed, or no regular file: no version to serve
  try {
    const installed = Installed.safeParse(JSON.parse(read.text));
    return installed.success ? installed.data.version : undefined;
  } catch {
    return undefined; // not JSON: a broken install has no version either
  }
}
