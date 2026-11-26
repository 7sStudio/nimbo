// A local package packages.add takes besides registry specs: a folder holding a package.json, or an npm tarball
// (.tgz, .tar.gz), named by a path that starts with ./, ../ or / (from the workspace root) or by a file: spec. The path
// is checked before the package manager runs and handed to it relative to the workspace root, so package.json names
// no machine's own absolute path (a path out of the workspace stays relative too, and is said). The package's name is
// read after, from the folder's package.json or from the tarball's: the archive is gunzipped as a stream, its tar
// headers walked to the first `<folder>/package.json`, and dropped past a small cap.
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { createGunzip } from "node:zlib";

import { readRegularFile } from "../regularFile.js";

/** Whether `spec` names a local package rather than one of the registry. */
export const isLocalSpec = (spec: string): boolean => /^(?:\.{1,2}\/|\/|file:)/u.test(spec);

const tarball = /\.(?:tgz|tar\.gz)$/u;

/** The path `spec` names, from the workspace `root`. */
const pathOf = (root: string, spec: string): string =>
  resolve(root, spec.startsWith("file:") ? spec.slice("file:".length) : spec);

/** Why the local `spec` cannot be added, or undefined when it names a package folder or a tarball. */
export async function localProblem(root: string, spec: string): Promise<string | undefined> {
  const path = pathOf(root, spec);
  const found = await stat(path).catch(() => undefined);
  if (found === undefined) return `${spec}: there is no such file or folder`;
  if (found.isDirectory()) {
    const manifest = await stat(join(path, "package.json")).catch(() => undefined);
    return manifest?.isFile() === true ? undefined : `${spec}: the folder has no package.json`;
  }
  if (found.isFile() && tarball.test(path)) return undefined;
  return `${spec}: a local package is a folder with a package.json or a .tgz tarball`;
}

/** The specs as the manager gets them: each local one as a path from the workspace root (`./x`, `../x`, forward
 * slashes), by its real path (the root is one: a temp folder reached through a link is not "outside"), and the ones
 * that lead out of the workspace. */
export async function relativeSpecs(
  root: string,
  names: readonly string[],
): Promise<{ readonly names: readonly string[]; readonly outside: readonly string[] }> {
  const outside: string[] = [];
  const reals = await Promise.all(
    names.map((name) =>
      isLocalSpec(name)
        ? realpath(pathOf(root, name)).catch(() => pathOf(root, name))
        : Promise.resolve(undefined),
    ),
  );
  const specs = names.map((name, at) => {
    const real = reals[at];
    if (real === undefined) return name;
    const from = relative(root, real);
    const posix = from.split(sep).join("/");
    if (from.startsWith("..") || isAbsolute(from)) {
      outside.push(posix);
      return posix;
    }
    return `./${posix}`;
  });
  return { names: specs, outside };
}

/** The most bytes of a tarball unpacked while its package.json is looked for. */
const maxUnpacked = 16 * 1024 * 1024;

const nameIn = (text: string): string | undefined => {
  try {
    const json: unknown = JSON.parse(text);
    const name: unknown =
      typeof json === "object" && json !== null ? Reflect.get(json, "name") : undefined;
    return typeof name === "string" ? name : undefined;
  } catch {
    return undefined;
  }
};

/** A tar header's text field. */
const field = (header: Buffer, from: number, length: number): string =>
  header
    .subarray(from, from + length)
    .toString("utf8")
    .replace(/\0.*$/su, "");

/** What a walk of tar blocks found so far: the package's name, or that the archive cannot hold it. */
type Walk = { readonly done: true; readonly name: string | undefined } | { readonly done: false };

/** Walks the tar blocks in `tar` from `at`; answers once package.json is read, or how far it got. */
function walkTar(tar: Buffer, start: number): { readonly found: Walk; readonly at: number } {
  let at = start;
  while (at + 512 <= tar.length) {
    const header = tar.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) return { found: { done: true, name: undefined }, at };
    const prefix = field(header, 345, 155);
    const name = `${prefix === "" ? "" : `${prefix}/`}${field(header, 0, 100)}`;
    const size = Number.parseInt(field(header, 124, 12).trim() || "0", 8);
    const end = at + 512 + size;
    if (/^[^/]+\/package\.json$/u.test(name)) {
      if (end > tar.length) return { found: { done: false }, at };
      const text = tar.subarray(at + 512, end).toString("utf8");
      return { found: { done: true, name: nameIn(text) }, at };
    }
    if (at + 512 + Math.ceil(size / 512) * 512 > tar.length) return { found: { done: false }, at };
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return { found: { done: false }, at };
}

/** The `name` of the package.json in the gzipped tar archive at `path`, read as a stream within the cap. */
function tarPackageName(path: string): Promise<string | undefined> {
  return new Promise((resolveName) => {
    const source = createReadStream(path);
    const gunzip = createGunzip();
    let held = Buffer.alloc(0);
    let at = 0;
    let unpacked = 0;
    const end = (name: string | undefined) => {
      source.destroy();
      gunzip.destroy();
      resolveName(name);
    };
    gunzip.on("data", (chunk: Buffer) => {
      unpacked += chunk.length;
      held = Buffer.concat([held.subarray(at), chunk]);
      at = 0;
      const walked = walkTar(held, 0);
      at = walked.at;
      if (walked.found.done) end(walked.found.name);
      else if (unpacked > maxUnpacked) end(undefined);
    });
    gunzip.on("end", () => {
      end(undefined);
    });
    gunzip.on("error", () => {
      end(undefined);
    });
    source.on("error", () => {
      end(undefined);
    });
    source.pipe(gunzip);
  });
}

/** The name of the package the local `spec` holds, or undefined when it cannot be read. */
export async function localPackageName(root: string, spec: string): Promise<string | undefined> {
  const path = pathOf(root, spec);
  if (tarball.test(path)) return tarPackageName(path);
  const read = await readRegularFile(join(path, "package.json"), 1024 * 1024);
  return read.kind === "read" ? nameIn(read.text) : undefined;
}
