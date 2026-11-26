// Names as their folders and files are spelled on disk: a file system that ignores case finds
// `Date-fns`, `lodash-es/Debounce.js` or `three/addons/controls/orbitControls.js` too, which would load one module
// under two URLs; such a spelling is refused.
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { readRegularFile } from "../regularFile.js";
import { parsedJson } from "./inputs.js";
import { patternEntry, targetOf } from "./packageFields.js";

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

/** The path `relative` (`a/b.js`) under `folder` as spelled on disk, the last segment found with an extension when
 * `extensions`; undefined when it names nothing. */
async function pathAsWritten(
  folder: string,
  relative: string,
  extensions: boolean,
): Promise<string | undefined> {
  const segments = relative.split("/");
  let parent = folder;
  const spelled: string[] = [];
  for (const [at, segment] of segments.entries()) {
    const found = await entryIn(parent, segment, extensions && at === segments.length - 1);
    if (found === undefined) return undefined;
    spelled.push(found.startsWith(`${segment}.`) ? segment : found);
    parent = join(parent, found);
  }
  return spelled.join("/");
}

/** The conditions of the page's import. */
const conditions = ["browser", "import", "module", "default"];

const SubpathMap = z.record(z.string(), z.unknown());

/** The file of the package that the pattern key of `exports` matching `subpath` names, as asked and as on disk. */
async function patternFile(folder: string, subpath: string, exports: unknown) {
  const map = SubpathMap.safeParse(exports).data;
  const spec = `./${subpath}`;
  if (map === undefined || Object.hasOwn(map, spec)) return undefined;
  const entry = patternEntry(map, spec);
  const target = entry && targetOf(map[entry.key], conditions);
  if (entry === undefined || target?.startsWith("./") !== true) return undefined;
  const file = target.slice(2).replaceAll("*", entry.match);
  const written = await pathAsWritten(folder, file, false);
  return written === undefined ? undefined : { entry, at: target.indexOf("*") - 2, file, written };
}

/** The subpath a pattern key of `exports` would be written with for `subpath` to name its file as spelled on disk;
 * undefined for an exact key (Node matches it as written), no pattern, or a target that names nothing. */
async function patternAsWritten(
  folder: string,
  subpath: string,
  exports: unknown,
): Promise<string | undefined> {
  const found = await patternFile(folder, subpath, exports);
  if (found === undefined || found.written === found.file) return undefined;
  const { entry, at, written } = found;
  const match = at < 0 ? entry.match : written.slice(at, at + entry.match.length);
  const corrected = entry.key.replace("*", match).slice(2);
  return corrected === subpath ? undefined : corrected;
}

/**
 * The spelling on disk of `subpath` (`""` or `lib/x.js`) of the package in `folder` when it differs from the one asked
 * for only by case; undefined when it is spelled so or names nothing on disk. A subpath of `exports` is matched as Node
 * does: an exact key as written, a pattern key by the file its target names.
 */
export async function subpathAsWritten(
  folder: string,
  subpath: string,
): Promise<string | undefined> {
  if (subpath === "") return undefined;
  const read = await readRegularFile(join(folder, "package.json"), 1024 * 1024);
  const fields = read.kind === "read" ? Exports.safeParse(parsedJson(read.text)).data : undefined;
  if (fields?.exports !== undefined) return patternAsWritten(folder, subpath, fields.exports);
  const written = await pathAsWritten(folder, subpath, true);
  return written === undefined || written === subpath ? undefined : written;
}
