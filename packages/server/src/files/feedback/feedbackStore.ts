// The UI feedback the page's feedback mode saves, kept in the workspace's `.jsnb/feedback/` (out of git, as everything
// under `.jsnb/` but the shared settings) for a later reader, a person or an agent: one JSON object
// per line in `feedback.jsonl`, oldest first, the same list as Markdown in `FEEDBACK.md`, and each entry's screenshots
// beside it as `<id>-element.png` and `<id>-viewport.png`. Every change of the file is a read-modify-write in the file's
// write queue, written atomically.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { writeAtomically } from "../atomicWrite.js";
import { inOrder } from "../writeQueue.js";
import type { FeedbackEntry, FeedbackInput } from "./entry.js";
import {
  changeInput,
  feedbackInput,
  isShotName,
  shotsInput,
  markdownOf,
  newId,
  parse,
  serialize,
} from "./entry.js";

/** The store's answer to a body: the entry, or why the body is no entry or no change. */
type Checked = { readonly entry: FeedbackEntry } | { readonly refused: string };

export type FeedbackStore = {
  /** The folder the entries are kept in. */
  readonly dir: string;
  /** Every entry, newest first. */
  readonly list: () => Promise<readonly FeedbackEntry[]>;
  /** Saves the entry `body` describes (feedbackInput). */
  readonly add: (body: unknown) => Promise<Checked>;
  /** The changed entry, or undefined when there is none with `id`. */
  readonly change: (id: string, body: unknown) => Promise<Checked | undefined>;
  /** Writes the screenshots `body` carries (shotsInput) for the entry `id`, replacing any it had of the same kind;
   * undefined when there is no entry with `id`. Repeating it changes nothing more. */
  readonly attach: (id: string, body: unknown) => Promise<Checked | undefined>;
  /** False when there is no entry with `id`. */
  readonly remove: (id: string) => Promise<boolean>;
  /** A screenshot's bytes, or undefined when `name` is not one of the folder's PNGs. */
  readonly shot: (name: string) => Promise<Buffer | undefined>;
};

const codeOf = (error: unknown): unknown =>
  error instanceof Error ? Reflect.get(error, "code") : undefined;

/** The bytes of `path`, or undefined when there is no file there. */
async function readIfThere(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (codeOf(error) === "ENOENT") return undefined;
    throw error;
  }
}

type Task<T> = (entries: FeedbackEntry[]) => { entries?: FeedbackEntry[]; out: T };

/** `feedback.jsonl` and `FEEDBACK.md` in `dir`: read, and changed one task at a time, both written atomically. */
function entriesFile(dir: string) {
  const file = join(dir, "feedback.jsonl");
  const read = async (): Promise<FeedbackEntry[]> =>
    parse((await readIfThere(file))?.toString("utf8") ?? "");
  const change = <T>(task: Task<T>) =>
    inOrder(file, async () => {
      const { entries, out } = task(await read());
      if (entries !== undefined) {
        await writeAtomically(file, serialize(entries));
        await writeAtomically(join(dir, "FEEDBACK.md"), markdownOf(entries));
      }
      return out;
    });
  return { read, change };
}

/** Writes the screenshots beside the entries as `<id>-<which>.png`; their names. */
async function writeShots(dir: string, id: string, input: FeedbackInput["shots"]) {
  const shots: { element?: string; viewport?: string } = {};
  for (const which of ["element", "viewport"] as const) {
    const data = input[which];
    if (data === undefined) continue;
    const name = `${id}-${which}.png`;
    await writeFile(join(dir, name), Buffer.from(data, "base64"));
    shots[which] = name;
  }
  return shots;
}

/** A new entry from `input`: an id, the time, open, and the daemon's version beside the page's build. */
async function entryOf(dir: string, input: FeedbackInput, server: string): Promise<FeedbackEntry> {
  await mkdir(dir, { recursive: true });
  const now = new Date();
  const id = newId(now);
  return {
    id,
    at: now.toISOString(),
    status: "open",
    text: input.text,
    selector: input.selector,
    components: input.components,
    element: input.element,
    ...(input.area === undefined ? {} : { area: input.area }),
    page: input.page,
    app: { ...input.app, server },
    shots: await writeShots(dir, id, input.shots),
  };
}

/** The entry `id` with `change` applied, or undefined. */
const changed =
  (file: ReturnType<typeof entriesFile>) =>
  (id: string, { status, text }: z.infer<typeof changeInput>) =>
    file.change((entries) => {
      const at = entries.findIndex((entry) => entry.id === id);
      const found = entries[at];
      if (found === undefined) return { out: undefined };
      const next = {
        ...found,
        ...(status === undefined ? {} : { status }),
        ...(text === undefined ? {} : { text }),
      };
      return { entries: entries.with(at, next), out: next };
    });

/** Adds screenshots to the entry `id`, which the page saves first without them so that leaving the page cannot lose
 * the note; undefined when there is no such entry. */
const attached =
  (dir: string, file: ReturnType<typeof entriesFile>) =>
  async (id: string, input: z.infer<typeof shotsInput>) => {
    if ((await file.read()).every((entry) => entry.id !== id)) return undefined;
    const shots = await writeShots(dir, id, input);
    const entry = await file.change((entries) => {
      const at = entries.findIndex((each) => each.id === id);
      const found = entries[at];
      if (found === undefined) return { out: undefined };
      const next = { ...found, shots: { ...found.shots, ...shots } };
      return { entries: entries.with(at, next), out: next };
    });
    // removed while the files were being written
    if (entry === undefined)
      for (const name of Object.values(shots)) await rm(join(dir, name), { force: true });
    return entry;
  };

/** Removes the entry `id` and its screenshots; false when there was none. */
const removed = (dir: string, file: ReturnType<typeof entriesFile>) => async (id: string) => {
  const gone = await file.change((entries) => {
    const found = entries.find((entry) => entry.id === id);
    if (found === undefined) return { out: undefined };
    return { entries: entries.filter((entry) => entry !== found), out: found };
  });
  if (gone === undefined) return false;
  for (const name of Object.values(gone.shots))
    if (isShotName(name)) await rm(join(dir, name), { force: true });
  return true;
};

/** The store over `<jsnbDir>/feedback/`, made when the first entry is saved; `serverVersion` is the daemon's. */
export function createFeedbackStore(jsnbDir: string, serverVersion: string): FeedbackStore {
  const dir = join(jsnbDir, "feedback");
  const file = entriesFile(dir);
  const update = changed(file);
  const attach = attached(dir, file);
  return {
    dir,
    list: async () => (await file.read()).reverse(),
    add: async (body) => {
      const parsed = feedbackInput.safeParse(body);
      if (!parsed.success) return { refused: z.prettifyError(parsed.error) };
      const entry = await entryOf(dir, parsed.data, serverVersion);
      return {
        entry: await file.change((entries) => ({ entries: [...entries, entry], out: entry })),
      };
    },
    change: async (id, body) => {
      const parsed = changeInput.safeParse(body);
      if (!parsed.success) return { refused: z.prettifyError(parsed.error) };
      const entry = await update(id, parsed.data);
      return entry === undefined ? undefined : { entry };
    },
    attach: async (id, body) => {
      const parsed = shotsInput.safeParse(body);
      if (!parsed.success) return { refused: z.prettifyError(parsed.error) };
      const entry = await attach(id, parsed.data);
      return entry === undefined ? undefined : { entry };
    },
    remove: removed(dir, file),
    shot: async (name) => (isShotName(name) ? readIfThere(join(dir, name)) : undefined),
  };
}
