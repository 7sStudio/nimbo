// What a package's own package.json decides for a bare import or `#name` of one of its files, before the bundle's
// plugin resolves it as a package (04-kernel §8.1). package.json files are read as regular
// files only and checked with Zod. The `browser` map is the nearest one above the importing file, as esbuild finds it:
// a nested package.json without a `browser` object (a `{"type": "commonjs"}` beside a package's CommonJS files, or a
// dependency's own) does not end its scope, a nearer one with a map replaces it. In it, a
// bare name mapped to `false` or to the package's own file is esbuild's to apply (it disables the name, or bundles the
// file), a name mapped to another bare name is that name (postcss's `"path": false`, readable-stream's `util`). The
// `imports` map is the nearest package.json's (Node's package scope, which esbuild follows too): a `#name` matched as
// Node matches it (an exact key, else the key with one `*` whose part before the `*` is longest, then the longest key:
// Node's PATTERN_KEY_COMPARE; note 4), its target picked under the browser, import or require, module and default
// conditions, is esbuild's to bundle when it names the package's own file, and that package's bare import when it
// names another package.
import { dirname, join } from "node:path";

import { z } from "zod";

import { readRegularFile } from "../regularFile.js";
import { parsedJson } from "./inputs.js";

const Fields = z.looseObject({
  browser: z
    .union([z.string(), z.record(z.string(), z.union([z.string(), z.literal(false)]))])
    .optional(),
  imports: z.record(z.string(), z.unknown()).optional(),
});
type Fields = z.infer<typeof Fields>;

/** What the package decides for an import: leave it to esbuild, or resolve another bare spec in its place. */
export type Decided =
  { readonly kind: "esbuild" } | { readonly kind: "bare"; readonly spec: string };

const esbuild: Decided = { kind: "esbuild" };

/** The fields of the package.json in `folder`, undefined when there is none; each folder read once a build. */
async function fieldsIn(folder: string, read: Map<string, Fields | undefined>) {
  if (!read.has(folder)) {
    const text = await readRegularFile(join(folder, "package.json"), 1024 * 1024);
    read.set(
      folder,
      text.kind === "read" ? (Fields.safeParse(parsedJson(text.text)).data ?? {}) : undefined,
    );
  }
  return read.get(folder);
}

type BrowserMap = Readonly<Record<string, string | false>>;

/** The scopes above `from`, the importing file's folder: the nearest package.json's `imports`, the nearest `browser` map. */
async function scopesAbove(from: string, read: Map<string, Fields | undefined>) {
  let nearest: Fields | undefined;
  for (let folder = from; ; folder = dirname(folder)) {
    const fields = await fieldsIn(folder, read);
    nearest ??= fields;
    const browser: BrowserMap | undefined =
      typeof fields?.browser === "object" ? fields.browser : undefined;
    if (browser !== undefined || dirname(folder) === folder) {
      return { imports: nearest?.imports ?? {}, browser };
    }
  }
}

/** The target of an `imports` value under the conditions of a page's import or require, as Node picks it. */
export function targetOf(value: unknown, conditions: readonly string[]): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const target = targetOf(item, conditions);
      if (target !== undefined) return target;
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) return undefined;
  for (const [condition, nested] of Object.entries(value)) {
    if (!conditions.includes(condition)) continue;
    const target = targetOf(nested, conditions);
    if (target !== undefined) return target;
  }
  return undefined;
}

/** Node's PATTERN_KEY_COMPARE for keys with one `*`: the longer part before the `*` first, then the longer key. */
const patternKeyCompare = (a: string, b: string): number =>
  b.indexOf("*") - a.indexOf("*") || b.length - a.length;

/**
 * What the key `key` (one `*`) matches in `spec`, as Node matches a pattern: its part before the `*` starts `spec` and
 * is not all of it, its part after the `*` ends `spec`, and `spec` is at least as long as the key; else undefined.
 */
function patternMatch(key: string, spec: string): string | undefined {
  const [head = "", tail = ""] = key.split("*");
  if (!spec.startsWith(head) || spec === head) return undefined;
  if (tail !== "" && (!spec.endsWith(tail) || spec.length < key.length)) return undefined;
  return spec.slice(head.length, spec.length - tail.length);
}

/**
 * The `imports` entry for `spec` as Node matches it: an exact key without `*`, else the first key with one `*` in
 * PATTERN_KEY_COMPARE order that matches `spec`, the match filling the target's `*`.
 */
function importsTarget(
  imports: Readonly<Record<string, unknown>>,
  spec: string,
  conditions: readonly string[],
) {
  if (!spec.includes("*") && Object.hasOwn(imports, spec))
    return targetOf(imports[spec], conditions);
  const patterns = Object.keys(imports).filter((key) => key.split("*").length === 2);
  for (const key of patterns.sort(patternKeyCompare)) {
    const match = patternMatch(key, spec);
    if (match !== undefined) return targetOf(imports[key], conditions)?.replaceAll("*", match);
  }
  return undefined;
}

/** A target that names the package's own file (or nothing usable) is esbuild's; one naming another package is it. */
const decidedBy = (target: string | false | undefined): Decided | undefined =>
  target === undefined
    ? undefined
    : target === false || /^\.\.?\//.test(target)
      ? esbuild
      : { kind: "bare", spec: target };

/**
 * What the importing package decides for `spec` imported from `from` (`require` true for a require): undefined when
 * its package.json says nothing of it, and a `#name` it does not map is esbuild's to report.
 */
export async function decided(
  spec: string,
  from: string,
  require: boolean,
  read: Map<string, Fields | undefined>,
): Promise<Decided | undefined> {
  const scopes = await scopesAbove(from, read);
  const conditions = ["browser", require ? "require" : "import", "module", "default"];
  if (spec.startsWith("#"))
    return decidedBy(importsTarget(scopes.imports, spec, conditions)) ?? esbuild;
  const { browser } = scopes;
  return browser && Object.hasOwn(browser, spec) ? decidedBy(browser[spec]) : undefined;
}

/** What one build has read of package.json files, by folder. */
export type FieldsRead = Map<string, Fields | undefined>;
