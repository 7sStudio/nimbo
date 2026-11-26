// The npm registry packages.search asks: the `registry` of the environment (npm_config_registry, as the package
// managers read it), else of the workspace's .npmrc, else of the user's ~/.npmrc, else registry.npmjs.org. Only an http
// or https address is taken, and only its origin and path: no credentials, and the .npmrc's tokens are never read.
import { homedir } from "node:os";
import { join } from "node:path";

import { readRegularFile } from "../regularFile.js";

const publicRegistry = "https://registry.npmjs.org";

/** The registry an address names, or undefined when it is no http or https address. */
function registryOf(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim().replace(/^["']|["']$/gu, "");
  if (!URL.canParse(text)) return undefined;
  const url = new URL(text);
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  return `${url.origin}${url.pathname}`.replace(/\/+$/u, "");
}

/** The `registry=` line of an .npmrc, or undefined. */
async function npmrcRegistry(path: string): Promise<string | undefined> {
  const read = await readRegularFile(path, 256 * 1024);
  if (read.kind !== "read") return undefined;
  const line = read.text
    .split(/\r?\n/u)
    .map((each) => /^\s*registry\s*=\s*(.+?)\s*$/u.exec(each)?.[1])
    .find((value) => value !== undefined);
  return registryOf(line);
}

export type RegistryWhere = {
  readonly root: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly home?: string;
};

/** The registry the workspace at `root` installs from, as far as its configuration says. */
export async function searchRegistry(where: RegistryWhere): Promise<string> {
  const env = where.env ?? process.env;
  return (
    registryOf(env.npm_config_registry ?? env.NPM_CONFIG_REGISTRY) ??
    (await npmrcRegistry(join(where.root, ".npmrc"))) ??
    (await npmrcRegistry(join(where.home ?? homedir(), ".npmrc"))) ??
    publicRegistry
  );
}
