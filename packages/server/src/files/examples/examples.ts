// The notebooks shipped with the app (Home's Tutorial and Examples): the `.jsnb` files of the server package's
// `examples/` folder, the tutorial's lessons in its `tutorial/` folder, which the package's `files` carries into an
// installed copy, read where they ship and never written. A copy goes into the workspace folder at the shipped path
// (a lesson under `tutorial/`), or the next free numbered name, created exclusively so nothing already there (a
// notebook, a link) is ever written over.
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { InvalidParams, parse, randomIds, summarize, tutorialName } from "@jsnb/core";

import { serverVersion } from "../version.js";

/** `packages/server/examples/`, from this module in `src/files/examples/` or `dist/files/examples/` alike. */
export const shippedExamples = fileURLToPath(new URL("../../../examples/", import.meta.url));

export type ExampleKind = "tutorial" | "example";

export type Example = {
  readonly name: string;
  readonly kind: ExampleKind;
  readonly title: string;
  readonly purpose: string;
  readonly cells: number;
};

/** The first sentence of a text: up to its first colon or full stop, ending with a full stop. */
const sentence = (text: string): string => {
  const end = text.search(/[:.](?:\s|$)/u);
  return `${(end < 0 ? text : text.slice(0, end)).trim()}.`;
};

const notebooksIn = async (dir: string): Promise<readonly string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsnb"))
    .map((entry) => entry.name)
    .sort();
};

/** The shipped notebooks' names (their paths under `dir` without .jsnb), the lessons first, then the examples. */
async function shippedNames(dir: string): Promise<readonly string[]> {
  const lessons = await notebooksIn(join(dir, tutorialName));
  const examples = await notebooksIn(dir);
  return [
    ...lessons.map((file) => `${tutorialName}/${file.replace(/\.jsnb$/u, "")}`),
    ...examples.map((file) => file.replace(/\.jsnb$/u, "")),
  ];
}

const kindOf = (name: string): ExampleKind =>
  name.startsWith(`${tutorialName}/`) ? "tutorial" : "example";

/** One shipped notebook read as its summary reads it: its title and the first sentence of its introduction. */
async function readExample(dir: string, name: string): Promise<Example> {
  const file = `${name}.jsnb`;
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
    kind: kindOf(name),
    title: summary.title || name,
    purpose: sentence(summary.text),
    cells: cells.length,
  };
}

/** Every shipped notebook: the tutorial's lessons, then the examples, each by file name. */
export async function listExamples(dir = shippedExamples): Promise<readonly Example[]> {
  const names = await shippedNames(dir);
  return Promise.all(names.map((name) => readExample(dir, name)));
}

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

const refused = (message: string) => new InvalidParams({ issues: [{ path: ["name"], message }] });

/** The most numbered names a copy tries before it gives up. */
const tries = 100;

/** The workspace's `tutorial/` folder, made when missing; a link or a file there is refused, so no copy lands outside
 * the workspace or over something that is not a folder. */
async function tutorialFolder(root: string): Promise<void> {
  const folder = join(root, tutorialName);
  await mkdir(folder).catch((error: unknown) => {
    if (codeOf(error) !== "EEXIST") throw error;
  });
  const stat = await lstat(folder);
  if (!stat.isDirectory())
    throw refused(
      `${tutorialName} in the workspace is not a folder; rename it to copy the tutorial`,
    );
}

/** Copies the shipped notebook `name` to its path under `root`, or the next free numbered name; answers the ref. */
async function copyOne(root: string, name: string, dir: string): Promise<string> {
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
  throw refused(
    `${name}.jsnb and ${String(tries - 1)} numbered copies exist already; rename or delete some`,
  );
}

/**
 * Copies the shipped notebook `name` into the workspace folder `root`, at its shipped path (`<name>.jsnb`, a lesson in
 * `tutorial/`), else `<name>-2.jsnb` and on; `tutorial` copies every lesson. Answers the copies' refs in order. A
 * name that is no shipped notebook is INVALID_PARAMS on `name`.
 */
export async function copyExample(
  root: string,
  name: string,
  dir = shippedExamples,
): Promise<readonly string[]> {
  const known = await shippedNames(dir);
  const lessons = known.filter((each) => kindOf(each) === "tutorial");
  const wanted = name === tutorialName ? lessons : known.filter((each) => each === name);
  if (wanted.length === 0) {
    const names = [tutorialName, ...known].join(", ");
    throw refused(`${name} is not a shipped notebook; the names are ${names}`);
  }
  if (wanted.some((each) => kindOf(each) === "tutorial")) await tutorialFolder(root);
  const refs: string[] = [];
  for (const each of wanted) refs.push(await copyOne(root, each, dir));
  return refs;
}
