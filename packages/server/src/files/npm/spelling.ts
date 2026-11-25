// Names as their folders and files are spelled on disk (04-kernel §8.1): a file system that ignores case finds
// `Date-fns` or `lodash-es/Debounce.js` too, which would load one module under two URLs; such a spelling is refused.
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { readRegularFile } from "../regularFile.js";
import { parsedJson } from "./inputs.js";

/** The entry of `folder` spelled `segment`: itself, the one spelled otherwise (another case), or undefined. */
async function entryIn(
  folder: string,
  segment: string,
  extensions = false,
): Promise<string | undefined> {
  const names = await readdir(folder).catch((): string[] => []);
  const same = (name: string) => name === segment || (extensions && name.startsWith(`${segment}.`));
  if (names.some(same)) return segment;
  const lower = segment.toLowerCase();
  return names.find(
    (name) =>
      name.toLowerCase() === lower || (extensions && name.toLowerCase().startsWith(`${lower}.`)),
  );
}

/** The name of the package folder `name` finds under `lookup`'s node_modules, as its folders are spelled on disk. */
export async function installedAs(lookup: string, name: string): Promise<string | undefined> {
  let parent = join(lookup, "node_modules");
  const spelled: string[] = [];
  for (const segment of name.split("/")) {
    const found = await entryIn(parent, segment);
    if (found === undefined) return undefined;
    spelled.push(found);
    parent = join(parent, found);
  }
  return spelled.join("/");
}

const Exports = z.looseObject({ exports: z.unknown().optional() });

/**
 * The spelling on disk of `subpath` (`""` or `lib/x.js`) of the package in `folder` when it differs from the one asked
 * for only by case; undefined when it is spelled so, names nothing on disk, or is a key of the package's `exports`
 * (which Node matches as written).
 */
export async function subpathAsWritten(
  folder: string,
  subpath: string,
): Promise<string | undefined> {
  if (subpath === "") return undefined;
  const read = await readRegularFile(join(folder, "package.json"), 1024 * 1024);
  const fields = read.kind === "read" ? Exports.safeParse(parsedJson(read.text)).data : undefined;
  if (fields?.exports !== undefined) return undefined;
  const segments = subpath.split("/");
  let parent = folder;
  const spelled: string[] = [];
  for (const [at, segment] of segments.entries()) {
    const found = await entryIn(parent, segment, at === segments.length - 1);
    if (found === undefined) return undefined;
    spelled.push(found.startsWith(`${segment}.`) ? segment : found);
    parent = join(parent, found);
  }
  const written = spelled.join("/");
  return written === subpath ? undefined : written;
}
