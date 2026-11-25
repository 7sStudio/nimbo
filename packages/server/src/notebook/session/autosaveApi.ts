// What an autosaver takes and answers (07-file-format §5; autosave.ts runs it): the notebook's file, its text, the
// events a save reports, and the calls a session makes of it.
import type { Log } from "../../events/log.js";
import type { FileIdentity } from "../../files/atomicWrite.js";

type AutosaveEvents = {
  readonly saved: (savedAt: string) => void;
  readonly failed: (error: { readonly code: string; readonly message: string }) => void;
  readonly conflict: (cells?: readonly string[]) => void;
};

/** VS Code's files.autoSave: after a pause in the changes (capped by a max wait while they go on), at a fixed interval,
 * when the page loses focus (the page sends notebook.save), or only on an explicit save. */
export type AutosavePolicy = {
  readonly mode: "afterDelay" | "onFocusChange" | "interval" | "off";
  readonly delayMs: number;
  readonly maxWaitMs: number;
  readonly intervalMs: number;
};

export type AutosaveOptions = {
  /** The notebook's file, read at each write: a followed move changes it (07 §5). */
  readonly path: string;
  /** The workspace folder, which a save never recreates. */
  readonly root: string;
  /** The notebook ref, as messages name it. */
  readonly ref: string;
  /** The file text of the current state (core's deterministic serialize). */
  readonly text: () => string;
  readonly now: () => Date;
  readonly events: AutosaveEvents;
  readonly log: Log;
  /** When writes happen (the files.autoSave settings, read at each change); without it, 100 ms after a change. */
  readonly policy?: () => AutosavePolicy;
  readonly retryMs?: number;
  /** Hears the identity of each file a save wrote (the move follower knows the file by it, 07 §5). */
  readonly written?: (identity: FileIdentity) => void;
  /** Called inside a write when nothing is at `path`: it may follow the file to where it moved, changing `path`. */
  readonly missing?: () => Promise<void>;
  /** Called inside a write when the file changed since the base: merges it into the state (07 §5), `off` when merging
   * is off (the write is a conflict then). */
  readonly external?: () => Promise<"merged" | "conflict" | "off">;
};

export type Autosaver = {
  /** After every mutation: a write as the policy says, unless a conflict suspends autosave. */
  readonly touched: () => void;
  /** notebook.save: writes now; NOTEBOOK_CONFLICT on a conflict unless `force`; SaveFailed when the write fails. */
  readonly save: (force: boolean) => Promise<string>;
  /** The session took `text` from the file (notebook.reload, a merge): the conflict is over, and the state is a version
   * of its own; `dirty` when the state still differs from it (a write follows as the policy says, and nothing says
   * saved). */
  readonly reloaded: (text: string, dirty: boolean) => void;
  /** An open conflict's merge took the file's other cells: `text` is the base from now on, the conflict stays. */
  readonly rebased: (text: string) => void;
  /**
   * Runs `work` (notebook.reload's read) in the queue of the file's writes: after the write under
   * way, before any later one, so a reload never reads a file a write is about to replace.
   */
  readonly exclusive: <T>(work: () => Promise<T>) => Promise<T>;
  /** The text the file held at the last read or write: the base of an external edit's merge (07 §5). */
  readonly base: () => { readonly text: string | undefined; readonly hash: string | undefined };
  /** An external edit changed `cells` on both sides: autosave stops until a reload or a forced save. */
  readonly conflicted: (cells: readonly string[]) => void;
  readonly state: () => {
    readonly savedAt: string | null;
    readonly dirty: boolean;
    readonly conflict: boolean;
  };
  /** Closing: writes the changes made since the load or the last save, unless a conflict suspends autosave. */
  readonly flush: () => Promise<void>;
  readonly close: () => void;
};
