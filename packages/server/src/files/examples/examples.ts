// The example notebooks shipped with the app (Home's Examples): the `.jsnb` files of the server
// package's `examples/` folder, which its `files` carries into an installed copy, read where they ship and never
// written. A copy goes into the workspace folder under the example's name, or the next free numbered name, created
// exclusively so nothing already there (a notebook, a link) is ever written over.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { InvalidParams, parse, randomIds, summarize } from "@jsnb/core";

import { serverVersion } from "../version.js";

/** `packages/server/examples/`, from this module in `src/files/examples/` or `dist/files/examples/` alike. */
export const shippedExamples = fileURLToPath(new URL("../../../examples/", import.meta.url));

export type Example = {
  readonly name: string;
  readonly title: string;
  readonly purpose: string;
  readonly cells: number;
};

/** The first sentence of a text: up to its first colon or full stop, ending with a full stop. */
const sentence = (text: string): string => {
  const end = text.search(/[:.](?:\s|$)/u);
  return `${(end < 0 ? text : text.slice(0, end)).trim()}.`;
};

/** One shipped example read as its summary reads it: its title and the first sentence of its introduction. */
async function readExample(dir: string, file: string): Promise<Example> {
  const name = file.replace(/\.jsnb$/u, "");
  const text = await readFile(join(dir, file), "utf8");
  const parsed = parse(text, { ids: randomIds(), path: file, appVersion: serverVersion });
  if (!parsed.ok) throw parsed.error;
  const cells = parsed.value.doc.cells.map(({ type, source }) => ({
    type,
    source,
    lastEdit: undefined,
    facts: undefined,
  }));
  const summary = summarize(file, cells, { packages: [] });
  return {
    name,
    title: summary.title || name,
    purpose: sentence(summary.text),
    cells: cells.length,
  };
}

/** Every shipped example, by file name. */
export async function listExamples(dir = shippedExamples): Promise<readonly Example[]> {
  const files = (await readdir(dir)).filter((file) => file.endsWith(".jsnb")).sort();
  return Promise.all(files.map((file) => readExample(dir, file)));
}

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

/** The most numbered names a copy tries before it gives up. */
const tries = 100;

/**
 * Copies the example `name` into the workspace folder `root`: `<name>.jsnb`, else `<name>-2.jsnb` and on; answers the
 * copy's ref. A name that is no shipped example is INVALID_PARAMS on `name`.
 */
export async function copyExample(
  root: string,
  name: string,
  dir = shippedExamples,
): Promise<string> {
  const known = (await readdir(dir)).filter((file) => file.endsWith(".jsnb"));
  if (!known.includes(`${name}.jsnb`)) {
    const names = known.map((file) => file.replace(/\.jsnb$/u, "")).join(", ");
    const message = `${name} is not a shipped example; the examples are ${names}`;
    throw new InvalidParams({ issues: [{ path: ["name"], message }] });
  }
  const text = await readFile(join(dir, `${name}.jsnb`), "utf8");
  for (let at = 1; at <= tries; at += 1) {
    const ref = at === 1 ? `${name}.jsnb` : `${name}-${String(at)}.jsnb`;
    try {
      await writeFile(join(root, ref), text, { flag: "wx", mode: 0o644 });
      return ref;
    } catch (error) {
      if (codeOf(error) !== "EEXIST") throw error;
    }
  }
  const message = `${name}.jsnb and ${String(tries - 1)} numbered copies exist already; rename or delete some`;
  throw new InvalidParams({ issues: [{ path: ["name"], message }] });
}
