// Autosave of 07-file-format §5, as VS Code's files.autoSave: by default one write once the changes pause for
// files.autoSaveDelay, never later than files.autoSaveMaxWait after the first change of a burst; or every
// files.autoSaveInterval; or only on notebook.save (onFocusChange, where the page saves as it loses focus, and off); deterministic text, the hash of
// the file on disk compared with the last write before every write (a mismatch suspends autosave: notebook.conflict
// until reload or a forced save), a failed write reported (notebook.saveFailed) and retried at the next mutation and
// every 10 s. Writes never overlap; nothing is written when the file already holds the state, and nothing at close unless
// the state was changed since it was loaded or saved (merely opening never changes the file, 07 §4); a close that
// leaves changes off the disk (a conflict, a failing save) logs a warning naming the notebook. A change that lands
// while a write is under way stays dirty: a write clears `dirty` only when no mutation came after the text it took,
// and a close writes until the file holds the last state.
import { NotebookConflict } from "@jsnb/core";

import { raced } from "../../files/atomicWrite.js";
import { hashOf, hashOnDisk, writeNotebook } from "../../files/notebooks/notebookFile.js";
import type { AutosaveOptions, AutosavePolicy, Autosaver } from "./autosaveApi.js";
import { SaveFailed, codeOf } from "./saveFailed.js";

type Outcome = "saved" | "unchanged" | "conflict" | "failed";

type Saver = {
  readonly options: AutosaveOptions;
  /** The text and hash last read or written. */
  text: string | undefined;
  hash: string | undefined;
  dirty: boolean;
  /** A mutation since the load, the last reload or the last write: what a close writes. */
  mutated: boolean;
  /** Counts the mutations: a write that took its text at one count clears `dirty` only if none came after. */
  version: number;
  conflict: boolean;
  conflictCells: readonly string[];
  savedAt: string | null;
  failure: SaveFailed | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** When the changes the timer waits for began (Date.now), for afterDelay's max wait. */
  burst: number | undefined;
  retry: ReturnType<typeof setTimeout> | undefined;
  chain: Promise<unknown>;
};

const later = (run: () => void, ms: number) => setTimeout(run, ms).unref();

function enterConflict(saver: Saver, cells?: readonly string[]): Outcome {
  if (!saver.conflict || cells !== undefined) saver.options.events.conflict(cells);
  saver.conflict = true;
  saver.conflictCells = cells ?? saver.conflictCells;
  void saver.options.recovery?.(true);
  return "conflict";
}

/** The conflict is over, whoever ended it: the page hears it before what follows (a save, a write). */
function endConflict(saver: Saver): void {
  if (!saver.conflict) return;
  saver.conflict = false;
  saver.conflictCells = [];
  saver.options.events.conflictEnded?.();
}

function failed(saver: Saver, error: unknown): Outcome {
  const { options } = saver;
  saver.failure = new SaveFailed({ path: options.ref, code: codeOf(error) }, { cause: error });
  options.log.warn({ err: error, notebook: options.ref }, "the notebook could not be saved");
  options.events.failed({ code: saver.failure.data.code, message: saver.failure.message });
  if (saver.dirty) void options.recovery?.(true);
  saver.retry ??= later(() => {
    saver.retry = undefined;
    if (saver.mutated) void enqueue(saver, false); // a failure again is reported again
  }, options.retryMs ?? 10_000);
  return "failed";
}

/** The state as of the mutation count `version` is on disk: clean, unless a mutation came after it. */
function caughtUp(saver: Saver, version: number): void {
  if (saver.version !== version) return; // a change landed during the write: still dirty, written next
  saver.dirty = false;
  saver.mutated = false;
}

function saved(
  saver: Saver,
  written: { readonly text: string; readonly version: number },
): Outcome {
  const { text, version } = written;
  endConflict(saver);
  Object.assign(saver, { text, hash: hashOf(text), failure: undefined });
  caughtUp(saver, version);
  saver.savedAt = saver.options.now().toISOString();
  saver.options.events.saved(saver.savedAt);
  if (!saver.dirty) void saver.options.recovery?.(false);
  return "saved";
}

/** The hash of the file on disk; when nothing is at its path, after the file was looked for where it moved (07 §5). */
async function diskHash(options: AutosaveOptions): Promise<string | undefined> {
  const disk = await hashOnDisk(options.path);
  if (disk !== undefined || options.missing === undefined) return disk;
  await options.missing(); // moved (followed to its new path) or deleted (written again where it was)
  return hashOnDisk(options.path);
}

/** Writes `text` to the notebook's file, telling `written` the file it made; `raced` when another program wrote it
 * since the base was read (left as it wrote it). A forced write replaces whatever is there. */
async function writeFile(saver: Saver, text: string, force: boolean): Promise<boolean> {
  const { options } = saver;
  const base = saver.hash;
  // a file deleted meanwhile is written again where it was, as a save after a delete is
  const replaces = (current: string | undefined) =>
    current === undefined || hashOf(current) === base;
  const identity = await writeNotebook(
    options.path,
    text,
    options.root,
    force ? undefined : replaces,
  );
  if (identity === raced) return false;
  options.written?.(identity); // a statement of its own: `?.` would skip the write with it
  return true;
}

/** The file holds the state: the same text, or, for a write no one asked for, nothing changed since it was read or
 * written (the text then differs only by the stamps of external edits, 07 §5). */
const holds = (
  saver: Saver,
  now: { readonly text: string; readonly disk: string | undefined },
  explicit: boolean,
): boolean =>
  now.disk === saver.hash &&
  (now.text === saver.text || (!explicit && !saver.dirty && !saver.mutated));

/** How many times a write merges another program's edit and tries again before it leaves the conflict to the user. */
const writeRounds = 3;

/** The file changed since the base: merged first (07 §5), or a conflict when merging is off or the merge found one. */
async function changedOnDisk(saver: Saver): Promise<Outcome | undefined> {
  const merged = (await saver.options.external?.()) ?? "off";
  if (merged === "off") return enterConflict(saver);
  return merged === "conflict" ? "conflict" : undefined;
}

/** One round of a write: `again` when another program's edit was merged first, or raced the replace. */
async function round(saver: Saver, force: boolean, explicit: boolean): Promise<Outcome | "again"> {
  if (saver.conflict && !force) return "conflict";
  const version = saver.version;
  const text = saver.options.text();
  const disk = await diskHash(saver.options);
  if (!force && disk !== undefined && disk !== saver.hash)
    return (await changedOnDisk(saver)) ?? "again";
  if (!force && holds(saver, { text, disk }, explicit)) {
    caughtUp(saver, version);
    return "unchanged";
  }
  return (await writeFile(saver, text, force)) ? saved(saver, { text, version }) : "again";
}

/** One write; never rejects: whatever fails (the serializer included) is the save's failure, reported and retried. */
async function write(saver: Saver, force: boolean, explicit: boolean): Promise<Outcome> {
  try {
    for (let count = 0; count < writeRounds; count += 1) {
      const outcome = await round(saver, force, explicit);
      if (outcome !== "again") return outcome;
    }
  } catch (error) {
    return failed(saver, error);
  }
  return enterConflict(saver); // the file kept changing under every write
}

function enqueue(saver: Saver, force: boolean, explicit = false): Promise<Outcome> {
  const next = saver.chain.then(() => write(saver, force, explicit));
  saver.chain = next;
  return next;
}

/** `work` in the queue of the file's writes; its failure is its caller's, the queue goes on. */
function exclusive<T>(saver: Saver, work: () => Promise<T>): Promise<T> {
  const run = saver.chain.then(work);
  saver.chain = run.catch(() => undefined); // the caller has the failure (a file gone, unreadable)
  return run;
}

const fallbackPolicy: AutosavePolicy = {
  mode: "afterDelay",
  delayMs: 100,
  maxWaitMs: 10_000,
  intervalMs: 120_000,
};

function fire(saver: Saver): void {
  saver.timer = undefined;
  saver.burst = undefined;
  // a load's normalization or migration is not a change: it waits for the next write the user causes (07 §4)
  if (!saver.mutated) return;
  void enqueue(saver, false); // its failure is reported as notebook.saveFailed and retried
}

/** The next write as the policy says: afterDelay waits for a pause (a debounce) but never past the max wait since the
 * first change it holds; interval writes at most once per interval; onFocusChange and off wait for notebook.save. */
function schedule(saver: Saver): void {
  const policy = saver.options.policy?.() ?? fallbackPolicy;
  if (policy.mode === "off" || policy.mode === "onFocusChange") return;
  if (policy.mode === "interval") {
    saver.timer ??= later(() => {
      fire(saver);
    }, policy.intervalMs);
    return;
  }
  const now = Date.now();
  saver.burst ??= now;
  clearTimeout(saver.timer);
  const wait = Math.min(policy.delayMs, saver.burst + policy.maxWaitMs - now);
  saver.timer = later(
    () => {
      fire(saver);
    },
    Math.max(0, wait),
  );
}

function touched(saver: Saver): void {
  saver.version += 1;
  saver.dirty = true;
  saver.mutated = true;
  if (saver.conflict || saver.failure !== undefined) void saver.options.recovery?.(true);
  if (!saver.conflict) schedule(saver);
}

async function save(saver: Saver, force: boolean): Promise<string> {
  const outcome = await enqueue(saver, force, true);
  if (outcome === "conflict") throw new NotebookConflict({ path: saver.options.ref });
  if (outcome === "failed" && saver.failure) throw saver.failure;
  saver.savedAt ??= saver.options.now().toISOString();
  return saver.savedAt;
}

/** How many writes a close makes for changes that keep landing while it writes, before it gives up and says so. */
const flushRounds = 5;

/** Closing: writes the changes made since the load or the last save, the last one too; warns when some stay off. */
async function flush(saver: Saver): Promise<void> {
  let outcome: Outcome = "saved";
  for (let round = 0; round < flushRounds; round += 1) {
    clearTimeout(saver.timer);
    saver.timer = undefined;
    saver.burst = undefined;
    if (!saver.mutated) return;
    outcome = saver.conflict ? "conflict" : await enqueue(saver, false);
    if (outcome === "conflict" || outcome === "failed") break;
  }
  const reason = outcome === "conflict" || outcome === "failed" ? outcome : "still changing";
  const kept = (await saver.options.recovery?.(true, true)) === true;
  saver.options.log.warn(
    { notebook: saver.options.ref, reason, recoveryCopy: kept },
    kept
      ? "the notebook closed with changes that are not on disk; they are kept in its recovery copy"
      : "the notebook closed with changes that are not on disk, and its recovery copy could not be written: they are lost",
  );
}

/** The state took `text` from the file; saved, as the page will say, only when the file holds the state. */
function reloaded(saver: Saver, text: string, dirty: boolean): void {
  clearTimeout(saver.timer); // the timer of the changes before it
  Object.assign(saver, { timer: undefined, burst: undefined });
  saver.version += 1; // a write that took its text before the reload clears nothing
  endConflict(saver);
  Object.assign(saver, { text, hash: hashOf(text), dirty, mutated: dirty });
  if (dirty) {
    schedule(saver);
    return;
  }
  saver.savedAt = saver.options.now().toISOString();
  saver.options.events.saved(saver.savedAt);
  void saver.options.recovery?.(false);
}

/** A conflict an external edit's merge found: no write is scheduled until it ends. */
function conflicted(saver: Saver, cells: readonly string[]): void {
  clearTimeout(saver.timer);
  saver.timer = undefined;
  enterConflict(saver, cells);
}

const stateOf = (saver: Saver) => ({
  savedAt: saver.savedAt,
  dirty: saver.dirty,
  mutated: saver.mutated,
  conflict: saver.conflict,
  conflictCells: saver.conflictCells,
});

/** An autosaver whose file holds `initial.text` (as read or written), dirty when the state differs already. */
export function createAutosaver(
  options: AutosaveOptions,
  initial: { readonly text: string | undefined; readonly dirty: boolean },
): Autosaver {
  const saver: Saver = {
    ...{
      options,
      text: initial.text,
      hash: initial.text === undefined ? undefined : hashOf(initial.text),
    },
    ...{ dirty: initial.dirty, mutated: false, version: 0, conflict: false, conflictCells: [] },
    ...{ savedAt: null, failure: undefined },
    ...{ timer: undefined, burst: undefined, retry: undefined, chain: Promise.resolve() },
  };
  return {
    touched: () => {
      touched(saver);
    },
    save: (force) => save(saver, force),
    exclusive: (work) => exclusive(saver, work),
    reloaded: (text, dirty) => {
      reloaded(saver, text, dirty);
    },
    rebased: (text) => {
      Object.assign(saver, { text, hash: hashOf(text) });
    },
    base: () => ({ text: saver.text, hash: saver.hash }),
    conflicted: (cells) => {
      conflicted(saver, cells);
    },
    state: () => stateOf(saver),
    flush: () => flush(saver),
    close: () => {
      clearTimeout(saver.timer);
      clearTimeout(saver.retry);
    },
  };
}
